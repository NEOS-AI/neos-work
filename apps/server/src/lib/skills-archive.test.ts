import { describe, expect, it } from 'vitest';

import { crc32 } from 'node:zlib';

import {
  classifyArchivePath,
  extractSkillZip,
  ZIPBALL_HTTP_MAX,
} from './skills-archive.js';
import { makeSkillZip, skillMd } from './fixtures/skill-zip.js';
import { SkillsHttpError } from './skills-source.js';

/** Minimal stored zip whose CD unix mode is a symlink (0120000). */
function makeSymlinkZip(linkName: string, target: string): Buffer {
  const name = Buffer.from(linkName);
  const data = Buffer.from(target);
  const crc = crc32(data);
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const cd = Buffer.alloc(46 + name.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(0x0314, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE((0o120777 << 16) >>> 0, 38);
  name.copy(cd, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cd, eocd]);
}

describe('classifyArchivePath', () => {
  it('rejects traversal, absolute, drive, and control paths; skips junk dirs', () => {
    expect(classifyArchivePath('SKILL.md')).toBe('ok');
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

  it('rejects a central-directory symlink entry', async () => {
    const buf = makeSymlinkZip('evil-link', '../outside');
    await expect(extractSkillZip(buf)).rejects.toMatchObject({
      http: 502,
      code: 'invalid_upstream',
    });
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
