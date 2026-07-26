import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkills } from './discovery.js';

describe('discoverSkills', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'neos-skills-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns empty when workspace has no skills dir', async () => {
    const skills = await discoverSkills(workspace);
    // May include global skills if present on the machine; filter to local only.
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('returns only global scan when workspacePath is omitted', async () => {
    const skills = await discoverSkills();
    expect(skills.every((s) => s.source === 'global')).toBe(true);
  });

  it('ignores control-char workspace paths (no local scan)', async () => {
    const skills = await discoverSkills(`\n${workspace}`);
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('discovers local SKILL.md-style files under .neos-work/skills', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'demo.md'),
      `---
name: demo
description: Demo skill
---
Body here
`,
    );
    await writeFile(join(dir, 'ignore.txt'), 'not a skill');
    await writeFile(join(dir, 'bad.md'), '# no frontmatter');

    const skills = await discoverSkills(workspace);
    const local = skills.filter((s) => s.source === 'local');
    expect(local).toHaveLength(1);
    expect(local[0]!.manifest.name).toBe('demo');
    expect(local[0]!.content).toContain('Body here');
  });

  it('skips directories and unreadable entries under skills', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(join(dir, 'nested-dir'), { recursive: true });
    await writeFile(
      join(dir, 'ok.md'),
      `---
name: ok
description: ok
---
x
`,
    );
    // dangling symlink .md file → unreadable / not a regular file
    await symlink(join(dir, 'missing-target.md'), join(dir, 'link.md'));

    const skills = await discoverSkills(workspace);
    const local = skills.filter((s) => s.source === 'local');
    expect(local.map((s) => s.manifest.name)).toEqual(['ok']);
  });

  it('skips hidden markdown files in skill directories', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '.hidden.md'),
      `---
name: hidden
description: hidden skill
---
Should skip
`,
    );
    await writeFile(
      join(dir, 'visible.md'),
      `---
name: visible
description: visible skill
---
Body
`,
    );
    const skills = await discoverSkills(workspace);
    const local = skills.filter((s) => s.source === 'local');
    expect(local.map((s) => s.manifest.name)).toEqual(['visible']);
  });

  it('treats blank workspacePath as omitted (no local scan)', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'demo.md'),
      `---
name: demo
description: Demo
---
x
`,
    );
    // hidden .md should be ignored when scanning
    await writeFile(
      join(dir, '.hidden.md'),
      `---
name: hidden
---
x
`,
    );
    const skills = await discoverSkills('   ');
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('rejects workspacePath containing control characters', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'demo.md'),
      `---
name: demo
description: Demo
---
x
`,
    );
    const skills = await discoverSkills(`${workspace}\0evil`);
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('caps discovered skills at 500 entries (ENTRY_MAX)', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    // Create 505 valid skill files — only first 500 should be kept
    for (let i = 0; i < 505; i++) {
      await writeFile(
        join(dir, `s${String(i).padStart(4, '0')}.md`),
        `---
name: s${i}
description: d
---
x
`,
      );
    }
    const local = (await discoverSkills(workspace)).filter((s) => s.source === 'local');
    expect(local.length).toBe(500);
  }, 30_000);

  it('skips overlong workspace paths, oversized skill files, and overlong entry names', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    // Valid skill
    await writeFile(
      join(dir, 'ok.md'),
      `---
name: ok
description: ok
---
body
`,
    );
    // Overlong filename (>200) — skipped
    await writeFile(
      join(dir, `${'n'.repeat(201)}.md`),
      `---
name: toolong
description: x
---
x
`,
    );
    // Oversized file (>1 MiB) — skipped
    await writeFile(
      join(dir, 'huge.md'),
      `---
name: huge
description: huge
---
${'x'.repeat(1 * 1024 * 1024 + 100)}
`,
    );

    const local = (await discoverSkills(workspace)).filter((s) => s.source === 'local');
    expect(local.map((s) => s.manifest.name)).toEqual(['ok']);

    // Workspace path longer than 4096 chars is ignored (no local scan)
    const overlongWs = `${workspace}${'/'.repeat(4_200)}`;
    const noLocal = (await discoverSkills(overlongWs)).filter((s) => s.source === 'local');
    expect(noLocal).toEqual([]);
  });
});
