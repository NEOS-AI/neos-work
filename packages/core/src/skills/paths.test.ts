import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SkillProvenance } from '@neos-work/shared';

import {
  classifyOccupancy,
  isPathInside,
  resolveUserSkillsDir,
  resolveWorkspaceSkillsDir,
  sanitizeSkillDirName,
} from './paths.js';
import { writeSkillProvenance } from './provenance.js';

function sampleProv(id: string): SkillProvenance {
  return {
    schemaVersion: 'neos-skill-source/v1',
    origin: 'skills.sh',
    id,
    source: 'owner/repo',
    slug: 'demo',
    trust: 'unverified',
    installedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('resolveUserSkillsDir', () => {
  it('honors NEOS_DATA_DIR and falls back on empty/control-char env', () => {
    const home = () => '/Users/demo';
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: '/data/neos' }, home)).toBe(
      join(resolve('/data/neos'), 'skills'),
    );
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: '  /data/neos  ' }, home)).toBe(
      join(resolve('/data/neos'), 'skills'),
    );
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: '' }, home)).toBe(
      join('/Users/demo', '.config', 'neos-work', 'skills'),
    );
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: '   ' }, home)).toBe(
      join('/Users/demo', '.config', 'neos-work', 'skills'),
    );
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: `\n/tmp/x` }, home)).toBe(
      join('/Users/demo', '.config', 'neos-work', 'skills'),
    );
    expect(resolveUserSkillsDir({ NEOS_DATA_DIR: `x${'\0'}y` }, home)).toBe(
      join('/Users/demo', '.config', 'neos-work', 'skills'),
    );
    expect(resolveUserSkillsDir({}, home)).toBe(
      join('/Users/demo', '.config', 'neos-work', 'skills'),
    );
  });

  it('defaults to ~/.config/neos-work/skills without NEOS_DATA_DIR', () => {
    expect(resolveUserSkillsDir({}, homedir)).toBe(
      join(homedir(), '.config', 'neos-work', 'skills'),
    );
  });
});

describe('resolveWorkspaceSkillsDir', () => {
  it('resolves .neos-work/skills under the workspace', () => {
    expect(resolveWorkspaceSkillsDir('/ws')).toBe(resolve('/ws', '.neos-work', 'skills'));
  });
});

describe('sanitizeSkillDirName', () => {
  it('kebabs, strips junk, and rejects empty/control-char names', () => {
    expect(sanitizeSkillDirName('Hello World')).toBe('hello-world');
    expect(sanitizeSkillDirName('find_skills')).toBe('find-skills');
    expect(sanitizeSkillDirName('  Foo--Bar!!  ')).toBe('foo-bar');
    expect(sanitizeSkillDirName('a'.repeat(80))).toHaveLength(64);
    expect(sanitizeSkillDirName('')).toBe('');
    expect(sanitizeSkillDirName('   ')).toBe('');
    expect(sanitizeSkillDirName('!!!')).toBe('');
    expect(sanitizeSkillDirName('bad\nname')).toBe('');
    expect(sanitizeSkillDirName(null)).toBe('');
  });
});

describe('isPathInside', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('treats lexical /var/folders root and realpath /private/var/folders candidate as inside', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-inside-'));
    const child = join(tmp, 'child');
    await mkdir(child);
    const realChild = realpathSync(child);
    expect(isPathInside(tmp, child)).toBe(true);
    expect(isPathInside(tmp, realChild)).toBe(true);
    expect(isPathInside(realpathSync(tmp), child)).toBe(true);
    if (tmp !== realpathSync(tmp)) {
      expect(tmp.includes('/var/') || realChild.includes('/private/var/')).toBe(true);
    }
  });

  it('rejects sibling paths (root-sibling is not inside root)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-sib-'));
    const root = join(tmp, 'root');
    const sibling = join(tmp, 'root-sibling');
    await mkdir(root);
    await mkdir(sibling);
    expect(isPathInside(root, sibling)).toBe(false);
    expect(isPathInside(root, join(root, 'child'))).toBe(true);
  });
});

describe('classifyOccupancy', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('empty dir → empty', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'empty');
    await mkdir(dir);
    expect(await classifyOccupancy(dir)).toBe('empty');
    expect(await classifyOccupancy(join(tmp, 'missing'))).toBe('empty');
  });

  it('SKILL.md + sidecar same remoteId → same_remote', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\n', 'utf8');
    await writeSkillProvenance(dir, sampleProv('owner/repo/x'));
    expect(await classifyOccupancy(dir, 'owner/repo/x')).toBe('same_remote');
    expect(await classifyOccupancy(dir, 'other/id')).toBe('occupied_remote');
  });

  it('SKILL.md no sidecar → occupied_skill', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, 'SKILL.md'), '---\nname: x\n---\n', 'utf8');
    expect(await classifyOccupancy(dir, 'owner/repo/x')).toBe('occupied_skill');
  });

  it('open-design.json, no SKILL.md → occupied_plugin', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, 'open-design.json'), '{"schemaVersion":"od-plugin/v1"}', 'utf8');
    expect(await classifyOccupancy(dir)).toBe('occupied_plugin');
  });

  it('other files → occupied_unknown', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, 'notes.txt'), 'not a skill', 'utf8');
    expect(await classifyOccupancy(dir)).toBe('occupied_unknown');
  });

  it('hidden-only leftovers → orphan', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeFile(join(dir, '.tmp-leftover'), 'partial', 'utf8');
    expect(await classifyOccupancy(dir)).toBe('orphan');
  });

  it('sidecar-only leftover → orphan', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeSkillProvenance(dir, sampleProv('owner/repo/x'));
    expect(await classifyOccupancy(dir, 'owner/repo/x')).toBe('orphan');
  });

  it('sidecar plus extra files → occupied_unknown', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-occ-'));
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    await writeSkillProvenance(dir, sampleProv('owner/repo/x'));
    await writeFile(join(dir, 'notes.txt'), 'not a skill', 'utf8');
    expect(await classifyOccupancy(dir, 'owner/repo/x')).toBe('occupied_unknown');
  });
});
