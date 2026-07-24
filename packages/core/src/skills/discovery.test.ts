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
});
