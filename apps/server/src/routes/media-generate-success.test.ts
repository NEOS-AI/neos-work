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
  };
});

import { generateAudio, generateImage, MEDIA_DIR } from '../lib/media-generator.js';
import media from './media.js';

beforeEach(() => {
  getSecretSettingMock.mockImplementation((key: string) => {
    if (key === 'OPENAI_API_KEY') return SECRET;
    return undefined;
  });
  vi.mocked(generateImage).mockReset();
  vi.mocked(generateAudio).mockReset();
  vi.mocked(generateImage).mockResolvedValue({
    filePath: `${MEDIA_DIR}/mock-image.png`,
    revisedPrompt: 'a refined cat',
  });
  vi.mocked(generateAudio).mockResolvedValue({
    filePath: `${MEDIA_DIR}/mock-audio.mp3`,
  });
});

describe('media generate success paths', () => {
  it('POST /image returns mocked generator result', async () => {
    const res = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat', size: '1024x1024', quality: 'hd' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { filename: string; revisedPrompt?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.filename).toBe('mock-image.png');
    expect(body.data.revisedPrompt).toBe('a refined cat');
    expect(generateImage).toHaveBeenCalledOnce();
  });

  it('POST /audio returns mocked generator result', async () => {
    const res = await media.request('/audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello world', voice: 'alloy', model: 'tts-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { filename: string } };
    expect(body.ok).toBe(true);
    expect(body.data.filename).toBe('mock-audio.mp3');
    expect(generateAudio).toHaveBeenCalledOnce();
  });

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
    expect(vi.mocked(generateImage).mock.calls[0]?.[0]).toMatchObject({
      prompt: 'from text field',
    });
  });

  it('POST /image returns 500 when generator throws', async () => {
    vi.mocked(generateImage).mockRejectedValueOnce(new Error('upstream down'));
    const res = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'fail me' }),
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

  it('POST /image returns 400 when API key missing', async () => {
    getSecretSettingMock.mockReturnValue(undefined);
    const res = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/OpenAI|key|configured/i);
  });
});
