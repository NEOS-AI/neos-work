import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEDIA_DIR } from './media-generator.js';
import { isSafeMediaFilename } from './media-filename.js';

describe('media filename safety', () => {
  it('accepts normal media names', () => {
    expect(isSafeMediaFilename('img_123.png')).toBe(true);
    expect(isSafeMediaFilename('audio-1.mp3')).toBe(true);
    expect(isSafeMediaFilename('  img_123.png  ')).toBe(true);
  });

  it('rejects path traversal and hidden names', () => {
    expect(isSafeMediaFilename('../etc/passwd')).toBe(false);
    expect(isSafeMediaFilename('a/b.png')).toBe(false);
    expect(isSafeMediaFilename('a\\b.png')).toBe(false);
    expect(isSafeMediaFilename('')).toBe(false);
    expect(isSafeMediaFilename('   ')).toBe(false);
    expect(isSafeMediaFilename('.hidden.png')).toBe(false);
    expect(isSafeMediaFilename('.')).toBe(false);
    expect(isSafeMediaFilename('..')).toBe(false);
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
