/**
 * Success paths for media generate endpoints (mocked OpenAI generator + settings).
 * Mocks getSecretSetting so parallel suites cannot race the shared OPENAI_API_KEY row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = `sk-test-media-success-${process.pid}`;

const getSecretSettingMock = vi.hoisted(() =>
  vi.fn((key: string): string | undefined => {
    if (key === 'OPENAI_API_KEY') return SECRET;
    return undefined;
  }),
);

vi.mock('../db/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/settings.js')>();
  return {
    ...actual,
    getSecretSetting: (key: string) => getSecretSettingMock(key),
  };
});

vi.mock('../lib/media-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/media-generator.js')>();
  return {
    ...actual,
    generateImage: vi.fn(async () => ({
      filePath: `${actual.MEDIA_DIR}/mock-image.png`,
      revisedPrompt: 'a refined cat',
    })),
    generateAudio: vi.fn(async () => ({
      filePath: `${actual.MEDIA_DIR}/mock-audio.mp3`,
    })),
    generateMediaUnified: vi.fn(async (input: { surface: string; prompt?: string; text?: string }) => {
      if (input.surface === 'image') {
        return {
          surface: 'image' as const,
          provider: 'openai',
          filePath: `${actual.MEDIA_DIR}/mock-image.png`,
          filename: 'mock-image.png',
          revisedPrompt: 'a refined cat',
        };
      }
      if (input.surface === 'audio') {
        return {
          surface: 'audio' as const,
          provider: 'openai',
          filePath: `${actual.MEDIA_DIR}/mock-audio.mp3`,
          filename: 'mock-audio.mp3',
        };
      }
      return {
        surface: 'video' as const,
        provider: 'xai',
        jobId: 'mjob_mock',
        status: 'queued',
        async: true as const,
      };
    }),
  };
});

import { generateMediaUnified, MEDIA_DIR } from '../lib/media-generator.js';
import media from './media.js';

beforeEach(() => {
  getSecretSettingMock.mockImplementation((key: string) => {
    if (key === 'OPENAI_API_KEY') return SECRET;
    return undefined;
  });
  vi.mocked(generateMediaUnified).mockReset();
  vi.mocked(generateMediaUnified).mockImplementation(async (input) => {
    if (input.surface === 'image') {
      const prompt = input.prompt ?? input.text ?? '';
      if (typeof prompt === 'string' && /[\0\r\n]/.test(prompt)) {
        throw new Error('prompt contains invalid control characters');
      }
      if (typeof prompt === 'string' && prompt.trim().length > 4000) {
        throw new Error('prompt too long (max 4000)');
      }
      if (typeof prompt === 'string' && !prompt.trim()) {
        throw new Error('prompt is required for image');
      }
      return {
        surface: 'image',
        provider: 'openai',
        filePath: `${MEDIA_DIR}/mock-image.png`,
        filename: 'mock-image.png',
        revisedPrompt: 'a refined cat',
      };
    }
    if (input.surface === 'audio') {
      const text = input.text ?? input.prompt ?? '';
      if (typeof text === 'string' && /\0/.test(text)) {
        throw new Error('text contains invalid control characters');
      }
      if (typeof text === 'string' && !text.trim()) {
        throw new Error('text is required for audio');
      }
      return {
        surface: 'audio',
        provider: 'openai',
        filePath: `${MEDIA_DIR}/mock-audio.mp3`,
        filename: 'mock-audio.mp3',
      };
    }
    return {
      surface: 'video',
      provider: 'xai',
      jobId: 'mjob_mock',
      status: 'queued',
      async: true,
    };
  });
});

describe('media generate success paths', () => {
  it('POST /generate image and audio surfaces', async () => {
    const img = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'image', prompt: 'sunset' }),
    });
    expect(img.status).toBe(200);
    const imgBody = (await img.json()) as { data: { surface: string; filename: string } };
    expect(imgBody.data.surface).toBe('image');
    expect(imgBody.data.filename).toBe('mock-image.png');

    const audio = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'audio', text: 'speak this' }),
    });
    expect(audio.status).toBe(200);
    const audioBody = (await audio.json()) as { data: { surface: string; filename: string } };
    expect(audioBody.data.surface).toBe('audio');
    expect(audioBody.data.filename).toBe('mock-audio.mp3');
  });

  it('POST /generate maps image prompt from text field', async () => {
    const res = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'image', text: 'from text field' }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(generateMediaUnified).mock.calls[0]?.[0]).toMatchObject({
      surface: 'image',
      text: 'from text field',
    });
  });

  it('POST /generate returns 500 when generator throws', async () => {
    vi.mocked(generateMediaUnified).mockRejectedValueOnce(new Error('upstream down'));
    const res = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'image', prompt: 'fail me' }),
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/upstream|Failed|error/i);
  });

  it('POST /generate rejects overlong image prompt and null audio text', async () => {
    const long = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'image', prompt: 'p'.repeat(4001) }),
    });
    expect(long.status).toBe(400);

    const nul = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'audio', text: `hi${'\0'}` }),
    });
    expect(nul.status).toBe(400);
  });

  it('POST /generate returns 400 when API key missing', async () => {
    getSecretSettingMock.mockReturnValue(undefined);
    vi.mocked(generateMediaUnified).mockRejectedValueOnce(
      new Error('OPENAI_API_KEY is not configured'),
    );
    const res = await media.request('/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'image', prompt: 'a cat' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/OpenAI|key|configured/i);
  });
});
