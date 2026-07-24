import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaNode } from './media.js';
import type { NodeContext } from '../types.js';

function ctx(partial: Partial<NodeContext> & { config?: Record<string, unknown> }): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'media',
    inputs: {},
    settings: { SERVER_URL: 'http://localhost:3001', SERVER_TOKEN: 'tok' },
    ...partial,
  };
}

describe('MediaNode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires image prompt', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'image' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No prompt/);
  });

  it('requires audio text', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'audio' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No text/);
  });

  it('rejects unknown media type', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'video' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown media type/);
  });

  it('normalizes mediaType case and whitespace', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({
        config: { mediaType: '  Image  ', prompt: 'a cat' },
        settings: { SERVER_URL: 'http://localhost:3001' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/image');
  });

  it('trims SERVER_URL and SERVER_TOKEN before calling the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'a cat' },
        settings: { SERVER_URL: '  http://localhost:3001  ', SERVER_TOKEN: '  tok  ' },
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/image');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('falls back to default SERVER_URL when whitespace-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'a cat' },
        settings: { SERVER_URL: '   ', SERVER_TOKEN: '' },
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/image');
  });

  it('posts image request and returns filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png', revisedPrompt: 'better' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'a cat', size: '1024x1024' } }),
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toContain('img.png');
    expect(String(result.output)).toContain('better');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/image');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe('a cat');
  });

  it('posts audio request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'speech.mp3' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hello', voice: 'nova' } }),
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toContain('speech.mp3');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.voice).toBe('nova');
  });

  it('propagates API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'quota exceeded' }),
    }));
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'image', prompt: 'x' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('quota exceeded');
  });

  it('uses upstream inputs.prompt when config prompt missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'from-input.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({
        config: { mediaType: 'image' },
        inputs: { prompt: 'from upstream' },
      }),
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe('from upstream');
  });

  it('sends Authorization bearer from SERVER_TOKEN', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'a.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(ctx({ config: { mediaType: 'image', prompt: 'p' } }));
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('rejects whitespace-only image prompt', async () => {
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: '   ' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No prompt/);
  });

  it('rejects image prompts over 4000 chars and audio text over 4096', async () => {
    const longPrompt = 'p'.repeat(4001);
    const img = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: longPrompt } }),
    );
    expect(img.ok).toBe(false);
    expect(img.error).toMatch(/4000/);

    const longText = 't'.repeat(4097);
    const audio = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: longText } }),
    );
    expect(audio.ok).toBe(false);
    expect(audio.error).toMatch(/4096/);
  });

  it('trims/lowercases size quality voice model options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'x.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: {
          mediaType: 'image',
          prompt: 'cat',
          size: '  1024x1024  ',
          quality: '  HD  ',
        },
      }),
    );
    const imgBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(imgBody.size).toBe('1024x1024');
    expect(imgBody.quality).toBe('hd');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'a.mp3' } }),
    });
    await MediaNode.execute(
      ctx({
        config: {
          mediaType: 'audio',
          text: 'hi',
          voice: '  NOVA  ',
          model: '  TTS-1-HD  ',
        },
      }),
    );
    const audioBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(audioBody.voice).toBe('nova');
    expect(audioBody.model).toBe('tts-1-hd');
  });

  it('falls back invalid size, quality, voice, and tts model to defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'x.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'p', size: '512x512', quality: 'ultra' },
      }),
    );
    const imgBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(imgBody.size).toBe('1024x1024');
    expect(imgBody.quality).toBe('standard');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'a.mp3' } }),
    });
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'audio', text: 'hi', voice: 'robot', model: 'whisper-1' },
      }),
    );
    const audioBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(audioBody.voice).toBe('alloy');
    expect(audioBody.model).toBe('tts-1');
  });

  it('preserves valid tts-1-hd model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'hd.mp3' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hi', model: 'tts-1-hd' } }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe('tts-1-hd');
  });

  it('defaults audio model to tts-1 when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'd.mp3' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hi' } }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe('tts-1');
  });

  it('propagates audio API error payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ ok: false, error: 'tts quota' }),
      }),
    );
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hi' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('tts quota');
  });

  it('preserves valid image quality hd', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'hd.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'p', quality: 'hd' } }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).quality).toBe('hd');
  });

  it('surfaces network failures for image generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'p' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/);
  });

  it('rejects whitespace-only audio text', async () => {
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: '  \t  ' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No text/);
  });

  it('uses inputs.text for audio and preserves valid voice/size', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 't.mp3' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'audio', voice: 'shimmer' },
        inputs: { text: '  spoken  ' },
      }),
    );
    const audioBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(audioBody.text).toBe('spoken');
    expect(audioBody.voice).toBe('shimmer');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'w.png' } }),
    });
    await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'wide', size: '1792x1024' } }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).size).toBe('1792x1024');
  });

  it('surfaces network failures for audio generation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hi' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/down/);
  });

  it('trims non-string prompt values via String()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'n.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image' },
        inputs: { prompt: 42 as unknown as string },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).prompt).toBe('42');
  });
});
