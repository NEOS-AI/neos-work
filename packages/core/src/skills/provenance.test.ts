import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SkillProvenance } from '@neos-work/shared';

import {
  readSkillProvenance,
  SKILL_PROVENANCE_FILENAME,
  validateSkillProvenance,
  writeSkillProvenance,
} from './provenance.js';

const valid: SkillProvenance = {
  schemaVersion: 'neos-skill-source/v1',
  origin: 'github',
  id: 'owner/repo/slug',
  source: 'owner/repo',
  slug: 'slug',
  trust: 'unverified',
  installedAt: '2026-01-01T00:00:00.000Z',
};

describe('validateSkillProvenance', () => {
  it('accepts a valid sidecar and rejects invalid fields', () => {
    expect(validateSkillProvenance(valid)).toEqual(valid);
    expect(validateSkillProvenance({ ...valid, schemaVersion: 'v0' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, origin: 'npm' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, trust: 'official' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, trust: 'community' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, id: '' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, id: '  ' })).toBeNull();
    expect(validateSkillProvenance({ ...valid, source: 'bad\nid' })).toBeNull();
    expect(validateSkillProvenance(null)).toBeNull();
    expect(validateSkillProvenance([])).toBeNull();
  });
});

describe('read/writeSkillProvenance', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('writes pretty JSON with trailing newline and reads it back', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-prov-'));
    await writeSkillProvenance(tmp, { ...valid, installUrl: 'https://example.com/s', ref: 'main' });
    const file = join(tmp, SKILL_PROVENANCE_FILENAME);
    const raw = await readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "schemaVersion":');
    const read = await readSkillProvenance(tmp);
    expect(read?.id).toBe(valid.id);
    expect(read?.installUrl).toBe('https://example.com/s');
    expect(read?.ref).toBe('main');
  });

  it('treats missing, invalid, and symlink sidecars as missing', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-prov-'));
    expect(await readSkillProvenance(tmp)).toBeNull();
    await writeFile(join(tmp, SKILL_PROVENANCE_FILENAME), '{"schemaVersion":"nope"}\n', 'utf8');
    expect(await readSkillProvenance(tmp)).toBeNull();

    const outside = join(tmp, 'outside.json');
    await writeFile(outside, JSON.stringify(valid), 'utf8');
    const dir = join(tmp, 'pkg');
    await mkdir(dir);
    try {
      await symlink(outside, join(dir, SKILL_PROVENANCE_FILENAME));
    } catch {
      return;
    }
    expect(await readSkillProvenance(dir)).toBeNull();
  });

  it('rejects writing invalid provenance', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neos-prov-'));
    await expect(
      writeSkillProvenance(tmp, { ...valid, trust: 'official' } as unknown as SkillProvenance),
    ).rejects.toThrow(/Invalid skill provenance/);
  });
});
