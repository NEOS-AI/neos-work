import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMediaFiles, MEDIA_DIR } from './media-generator.js';

const PREFIX = `_cov_media_${process.pid}_`;

async function write(name: string, content: string) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, name), content, 'utf8');
}

afterEach(async () => {
  try {
    const names = await fs.readdir(MEDIA_DIR);
    for (const n of names) {
      if (n.startsWith(PREFIX)) {
        await fs.unlink(path.join(MEDIA_DIR, n)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
});

describe('listMediaFiles', () => {
  beforeEach(async () => {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
  });

  it('classifies image and audio extensions', async () => {
    await write(`${PREFIX}a.png`, 'png');
    await write(`${PREFIX}b.mp3`, 'mp3');
    await write(`${PREFIX}c.txt`, 'txt');
    // Dotfiles are ignored by listMediaFiles
    await write(`.${PREFIX}hidden`, 'x');

    const files = await listMediaFiles(50);
    const ours = files.filter((f) => f.filename.startsWith(PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(3);

    const png = ours.find((f) => f.filename.endsWith('.png'));
    const mp3 = ours.find((f) => f.filename.endsWith('.mp3'));
    const txt = ours.find((f) => f.filename.endsWith('.txt'));
    expect(png?.kind).toBe('image');
    expect(png?.mimeType).toBe('image/png');
    expect(mp3?.kind).toBe('audio');
    expect(txt?.kind).toBe('other');
    expect(png?.urlPath).toContain('/api/media/file/');
  });

  it('respects limit and sorts newest first', async () => {
    await write(`${PREFIX}old.png`, '1');
    // ensure different mtime
    await new Promise((r) => setTimeout(r, 20));
    await write(`${PREFIX}new.png`, '2');

    const files = await listMediaFiles(1);
    // limit applies to all media dir files, so we only assert our new file can appear when limit high
    const all = await listMediaFiles(500);
    const ours = all.filter((f) => f.filename.startsWith(PREFIX));
    expect(ours[0]?.filename).toContain('new.png');
    expect(files.length).toBeLessThanOrEqual(1);
  });

  it('clamps limit bounds', async () => {
    const a = await listMediaFiles(0);
    const b = await listMediaFiles(9999);
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
    expect(b.length).toBeLessThanOrEqual(500);
  });
});
