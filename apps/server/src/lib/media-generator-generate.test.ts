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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(generateImage({ prompt: 'x', apiKey: 'sk' })).rejects.toThrow(/Failed to download/);
  });

  it('rejects blank apiKey after trim', async () => {
    await expect(generateImage({ prompt: 'x', apiKey: '   ' })).rejects.toThrow(/apiKey/i);
  });

  it('clamps invalid size/quality and rejects blank prompt', async () => {
    generateMock.mockResolvedValue({
      data: [{ url: 'https://cdn.example/img.png' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      }),
    );

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
});
