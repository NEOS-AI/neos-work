import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const generateMock = vi.fn();
const speechCreateMock = vi.fn();

vi.mock('openai', () => ({
  default: class OpenAI {
    images = { generate: generateMock };
    audio = { speech: { create: speechCreateMock } };
    constructor(_opts: { apiKey: string }) {}
  },
}));

import { generateAudio, generateImage, MEDIA_DIR } from './media-generator.js';

const created: string[] = [];

/** Minimal fetch Response shape used by generateImage download path. */
function fetchImageOk(bytes: number[] | Uint8Array, contentLength?: string | null) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    ok: true as const,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-length'
          ? contentLength === undefined
            ? String(buf.byteLength)
            : contentLength
          : null,
    },
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

afterEach(async () => {
  generateMock.mockReset();
  speechCreateMock.mockReset();
  vi.unstubAllGlobals();
  for (const f of created.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('generateImage', () => {
  it('downloads image URL and writes a local file', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/img.png', revised_prompt: 'better' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchImageOk([1, 2, 3])));

    const result = await generateImage({
      prompt: 'a cat',
      apiKey: 'sk-test',
    });
    expect(result.revisedPrompt).toBe('better');
    expect(result.url).toContain('cdn.example');
    expect(result.filePath.startsWith(MEDIA_DIR)).toBe(true);
    created.push(result.filePath);
    const st = await fs.stat(result.filePath);
    expect(st.size).toBe(3);
    expect(path.basename(result.filePath)).toMatch(/^img_.*\.png$/);
  });

  it('throws when OpenAI returns no URL', async () => {
    generateMock.mockResolvedValue({ data: [{}] });
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/No image URL/);
  });

  it('throws when image download fails', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/fail.png' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        headers: { get: () => null },
      }),
    );
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/Failed to download/);
  });

  it('rejects blank apiKey after trim', async () => {
    await expect(generateImage({ prompt: 'x', apiKey: '   ' })).rejects.toThrow(/apiKey/i);
  });

  it('rejects image prompts over 4000 characters', async () => {
    await expect(
      generateImage({ prompt: 'p'.repeat(4001), apiKey: 'sk' }),
    ).rejects.toThrow(/prompt too long/i);
  });

  it('rejects image prompts with control characters', async () => {
    await expect(
      generateImage({ prompt: `line1${'\n'}line2`, apiKey: 'sk' }),
    ).rejects.toThrow(/control characters/i);
  });

  it('clamps invalid size/quality and rejects blank prompt', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/img.png' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchImageOk([1])));


    await expect(generateImage({ prompt: '   ', apiKey: 'sk' })).rejects.toThrow(/prompt/i);

    const result = await generateImage({
      prompt: '  a dog  ',
      // @ts-expect-error intentional invalid options
      size: '512x512',
      // @ts-expect-error intentional invalid options
      quality: 'ultra',
      apiKey: 'sk',
    });
    created.push(result.filePath);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a dog',
        size: '1024x1024',
        quality: 'standard',
      }),
    );
  });

  it('rejects non-http(s) image URLs before download', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'file:///tmp/evil.png' }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/http\(s\)/i);
    expect(fetchMock).not.toHaveBeenCalled();

    generateMock.mockResolvedValue({
      data: [{ url: 'not a url' }],
    });
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/Invalid image URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized image downloads via Content-Length and body size', async () => {
    const max = 16 * 1024 * 1024;
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/huge.png' }],
    });

    // Content-Length over cap → reject without buffering body
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? String(max + 1) : null) },
        arrayBuffer: async () => {
          throw new Error('should not read body when Content-Length exceeds max');
        },
      }),
    );
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/max size/i);

    // No Content-Length but body too large
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array(max + 1).buffer,
      }),
    );
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/max size/i);
  });
});

describe('generateAudio', () => {
  it('writes mp3 from speech API', async () => {
    speechCreateMock.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
    });
    const result = await generateAudio({
      text: 'hello',
      apiKey: 'sk-test',
      voice: 'nova',
    });
    expect(result.filePath.startsWith(MEDIA_DIR)).toBe(true);
    created.push(result.filePath);
    const st = await fs.stat(result.filePath);
    expect(st.size).toBe(2);
    expect(path.basename(result.filePath)).toMatch(/^audio_.*\.mp3$/);
  });

  it('rejects audio text over 4096 characters', async () => {
    await expect(
      generateAudio({ text: 't'.repeat(4097), apiKey: 'sk' }),
    ).rejects.toThrow(/text too long/i);
  });

  it('rejects oversized TTS audio payloads (16 MiB cap)', async () => {
    const max = 16 * 1024 * 1024;
    speechCreateMock.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array(max + 1).buffer,
    });
    await expect(
      generateAudio({ text: 'hello', apiKey: 'sk' }),
    ).rejects.toThrow(/Audio exceeds max size/i);
  });

  it('clamps invalid voice/model and rejects blank text', async () => {
    speechCreateMock.mockResolvedValue({
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await expect(generateAudio({ text: '  ', apiKey: 'sk' })).rejects.toThrow(/text/i);
    await expect(generateAudio({ text: 'hi', apiKey: '   ' })).rejects.toThrow(/apiKey/i);

    const result = await generateAudio({
      text: '  hi  ',
      // @ts-expect-error intentional invalid options
      voice: 'robot',
      // @ts-expect-error intentional invalid options
      model: 'tts-2',
      apiKey: 'sk',
    });
    created.push(result.filePath);
    expect(speechCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'hi',
        voice: 'alloy',
        model: 'tts-1',
      }),
    );
  });

  it('normalizes image size case', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/img.png' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchImageOk([9])));

    const result = await generateImage({
      prompt: 'case',
      // @ts-expect-error intentional case
      size: '1024X1024',
      apiKey: 'sk',
    });
    created.push(result.filePath);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1024' }),
    );
  });
});
