import { describe, expect, it } from 'vitest';

import {
  classifyArchivePath,
  extractSkillZip,
  isSafeSnapshotRelPath,
  ZIPBALL_HTTP_MAX,
} from './skills-archive.js';
import { makeSkillZip, skillMd } from './fixtures/skill-zip.js';
import { SkillsHttpError } from './skills-source.js';

describe('classifyArchivePath', () => {
  it('rejects traversal, absolute, drive, and control paths; skips junk dirs', () => {
    expect(isSafeSnapshotRelPath('SKILL.md')).toBe('ok');
    expect(classifyArchivePath('../SKILL.md')).toBe('reject');
    expect(classifyArchivePath('.')).toBe('reject');
    expect(classifyArchivePath('/abs/SKILL.md')).toBe('reject');
    expect(classifyArchivePath('C:\\SKILL.md')).toBe('reject');
    expect(classifyArchivePath('foo\0bar')).toBe('reject');
    expect(classifyArchivePath('__MACOSX/foo')).toBe('skip');
    expect(classifyArchivePath('pkg/.git/config')).toBe('skip');
    expect(classifyArchivePath('pkg/node_modules/x')).toBe('skip');
  });
});

describe('extractSkillZip', () => {
  it('unwraps a single top-level folder and skips junk paths', async () => {
    const buf = await makeSkillZip([
      { name: 'repo-main/SKILL.md', content: skillMd('rooty') },
      { name: 'repo-main/references/a.md', content: 'ref' },
      { name: 'repo-main/LICENSE', content: 'MIT' },
      { name: '__MACOSX/._SKILL.md', content: 'mac' },
      { name: 'repo-main/.git/config', content: 'git' },
    ]);
    const files = await extractSkillZip(buf);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['LICENSE', 'SKILL.md', 'references/a.md']);
  });

  it('rejects .. segments in zip entries', async () => {
    const buf = await makeSkillZip([
      { name: 'ok/SKILL.md', content: skillMd('ok') },
      { name: 'ok/../escape.md', content: 'nope' },
    ]);
    // archiver may normalize .. away; if preserved, extract must reject
    try {
      const files = await extractSkillZip(buf);
      expect(files.every((f) => !f.path.includes('..'))).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(SkillsHttpError);
      expect((err as SkillsHttpError).code).toBe('invalid_upstream');
    }
  });

  it('rejects an empty buffer and oversize http payload', async () => {
    await expect(extractSkillZip(Buffer.alloc(0))).rejects.toMatchObject({
      http: 502,
      code: 'invalid_upstream',
    });
    await expect(extractSkillZip(Buffer.alloc(ZIPBALL_HTTP_MAX + 1))).rejects.toMatchObject({
      http: 502,
      code: 'upstream_too_large',
    });
  });
});
