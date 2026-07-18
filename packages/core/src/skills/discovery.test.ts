import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
    expect(local[0].manifest.name).toBe('demo');
    expect(local[0].content).toContain('Body here');
  });
});
