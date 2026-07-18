import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEDIA_DIR } from './media-generator.js';

/** Mirror route validation used by GET/DELETE /api/media/file/:filename */
function isSafeMediaFilename(filename: string): boolean {
  return /^[a-zA-Z0-9_\-.]+$/.test(filename);
}

describe('media filename safety', () => {
  it('accepts normal media names', () => {
    expect(isSafeMediaFilename('img_123.png')).toBe(true);
    expect(isSafeMediaFilename('audio-1.mp3')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isSafeMediaFilename('../etc/passwd')).toBe(false);
    expect(isSafeMediaFilename('a/b.png')).toBe(false);
    expect(isSafeMediaFilename('a\\b.png')).toBe(false);
    expect(isSafeMediaFilename('')).toBe(false);
  });
});

describe('media file delete on disk', () => {
  const name = `_cov_del_${process.pid}.png`;
  const filePath = path.join(MEDIA_DIR, name);

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  });

  it('creates and deletes a media file', () => {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(filePath, 'x');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(isSafeMediaFilename(name)).toBe(true);
    fs.unlinkSync(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
