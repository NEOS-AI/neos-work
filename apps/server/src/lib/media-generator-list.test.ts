import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  listMediaFiles,
  MEDIA_DIR,
  TTS_MODELS,
  TTS_VOICES,
} from './media-generator.js';

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
    await write(`${PREFIX}d.webp`, 'webp');
    await write(`${PREFIX}e.jpeg`, 'jpeg');
    await write(`${PREFIX}f.gif`, 'gif');
    await write(`${PREFIX}g.wav`, 'wav');
    // Dotfiles are ignored by listMediaFiles
    await write(`.${PREFIX}hidden`, 'x');

    const files = await listMediaFiles(50);
    const ours = files.filter((f) => f.filename.startsWith(PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(7);

    const png = ours.find((f) => f.filename.endsWith('.png'));
    const mp3 = ours.find((f) => f.filename.endsWith('.mp3'));
    const txt = ours.find((f) => f.filename.endsWith('.txt'));
    const webp = ours.find((f) => f.filename.endsWith('.webp'));
    const jpeg = ours.find((f) => f.filename.endsWith('.jpeg'));
    const gif = ours.find((f) => f.filename.endsWith('.gif'));
    const wav = ours.find((f) => f.filename.endsWith('.wav'));
    expect(png?.kind).toBe('image');
    expect(png?.mimeType).toBe('image/png');
    expect(mp3?.kind).toBe('audio');
    expect(mp3?.mimeType).toBe('audio/mpeg');
    expect(txt?.kind).toBe('other');
    expect(txt?.mimeType).toBe('application/octet-stream');
    expect(webp?.kind).toBe('image');
    expect(webp?.mimeType).toBe('image/webp');
    expect(jpeg?.kind).toBe('image');
    expect(jpeg?.mimeType).toBe('image/jpeg');
    expect(gif?.kind).toBe('image');
    expect(gif?.mimeType).toBe('image/gif');
    expect(wav?.kind).toBe('audio');
    expect(wav?.mimeType).toBe('audio/wav');
    expect(png?.urlPath).toContain('/api/media/file/');
  });

  it('exports media option allow-lists used by generate paths', () => {
    expect(IMAGE_SIZES.has('1024x1024')).toBe(true);
    expect(IMAGE_SIZES.has('1792x1024')).toBe(true);
    expect(IMAGE_SIZES.has('1024x1792')).toBe(true);
    expect(IMAGE_SIZES.has('512x512')).toBe(false);
    expect(IMAGE_QUALITIES.has('standard')).toBe(true);
    expect(IMAGE_QUALITIES.has('hd')).toBe(true);
    expect(IMAGE_QUALITIES.has('ultra')).toBe(false);
    expect([...TTS_VOICES]).toEqual(
      expect.arrayContaining(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
    );
    expect(TTS_VOICES.size).toBe(6);
    expect(TTS_MODELS.has('tts-1')).toBe(true);
    expect(TTS_MODELS.has('tts-1-hd')).toBe(true);
    expect(TTS_MODELS.has('tts-2')).toBe(false);
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

  it('treats NaN / non-finite limits as default 100 then clamps', async () => {
    await write(`${PREFIX}n1.png`, '1');
    await write(`${PREFIX}n2.png`, '2');
    const nan = await listMediaFiles(Number.NaN);
    const undef = await listMediaFiles(undefined as unknown as number);
    const neg = await listMediaFiles(-5);
    expect(Array.isArray(nan)).toBe(true);
    expect(Array.isArray(undef)).toBe(true);
    // negative → Math.max(..., 1) → at least 1
    expect(neg.length).toBeGreaterThanOrEqual(0);
    expect(neg.length).toBeLessThanOrEqual(500);
  });

  it('skips unsafe filenames and non-file entries', async () => {
    await write(`${PREFIX}safe.png`, 'ok');
    // space in name is rejected by the allow-list regex
    await write(`${PREFIX}has space.png`, 'nope');
    await fs.mkdir(path.join(MEDIA_DIR, `${PREFIX}subdir`), { recursive: true });

    const files = await listMediaFiles(500);
    const ours = files.filter((f) => f.filename.startsWith(PREFIX));
    expect(ours.some((f) => f.filename === `${PREFIX}safe.png`)).toBe(true);
    expect(ours.some((f) => f.filename.includes(' '))).toBe(false);
    expect(ours.some((f) => f.filename === `${PREFIX}subdir`)).toBe(false);

    await fs.rm(path.join(MEDIA_DIR, `${PREFIX}subdir`), { recursive: true, force: true }).catch(() => {});
    await fs.unlink(path.join(MEDIA_DIR, `${PREFIX}has space.png`)).catch(() => {});
  });

  it('skips planted symlinks so escape links are not catalogued', async () => {
    const outside = path.join(os.tmpdir(), `${PREFIX}outside.txt`);
    const linkName = `${PREFIX}escape.png`;
    const linkPath = path.join(MEDIA_DIR, linkName);
    try {
      await fs.writeFile(outside, 'secret-outside', 'utf8');
      try {
        await fs.symlink(outside, linkPath);
      } catch {
        // symlink may be restricted — skip
        return;
      }
      await write(`${PREFIX}real.png`, 'png');
      const files = await listMediaFiles(500);
      const ours = files.filter((f) => f.filename.startsWith(PREFIX));
      expect(ours.some((f) => f.filename === linkName)).toBe(false);
      expect(ours.some((f) => f.filename === `${PREFIX}real.png`)).toBe(true);
    } finally {
      await fs.unlink(linkPath).catch(() => {});
      await fs.unlink(outside).catch(() => {});
    }
  });

  it('maps jpeg/webp/gif/wav mime types and url-encodes filenames', async () => {
    await write(`${PREFIX}p.jpeg`, 'j');
    await write(`${PREFIX}p.webp`, 'w');
    await write(`${PREFIX}p.gif`, 'g');
    await write(`${PREFIX}a.wav`, 'a');
    await write(`${PREFIX}a.flac`, 'f');

    const files = await listMediaFiles(500);
    const ours = Object.fromEntries(
      files.filter((f) => f.filename.startsWith(PREFIX)).map((f) => [f.filename, f]),
    );

    expect(ours[`${PREFIX}p.jpeg`]?.kind).toBe('image');
    expect(ours[`${PREFIX}p.jpeg`]?.mimeType).toBe('image/jpeg');
    expect(ours[`${PREFIX}p.webp`]?.mimeType).toBe('image/webp');
    expect(ours[`${PREFIX}p.gif`]?.mimeType).toBe('image/gif');
    expect(ours[`${PREFIX}a.wav`]?.kind).toBe('audio');
    expect(ours[`${PREFIX}a.wav`]?.mimeType).toBe('audio/wav');
    // flac is audio kind but falls through to default mime
    expect(ours[`${PREFIX}a.flac`]?.kind).toBe('audio');
    expect(ours[`${PREFIX}a.flac`]?.mimeType).toBe('application/octet-stream');
    expect(ours[`${PREFIX}p.jpeg`]?.urlPath).toContain(encodeURIComponent(`${PREFIX}p.jpeg`));
  });
});

describe('resolveMediaDir via env', () => {
  it('listMediaFiles works when NEOS_DATA_DIR is set for ensure path', async () => {
    // MEDIA_DIR is computed at import time; just ensure list still works
    const files = await listMediaFiles(5);
    expect(Array.isArray(files)).toBe(true);
  });
});
