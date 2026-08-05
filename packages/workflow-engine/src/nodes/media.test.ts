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

  it('rejects image prompt with control characters', async () => {
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'a\nb' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/control characters/i);

    // Leading control-char must not strip to a valid prompt
    const leading = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: '\nok-looking' } }),
    );
    expect(leading.ok).toBe(false);
    expect(leading.error).toMatch(/control characters/i);
  });

  it('requires audio text', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'audio' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No text/);
  });

  it('rejects audio text with null bytes (multi-line TTS allowed)', async () => {
    const nullByte = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: `hello${'\0'}world` } }),
    );
    expect(nullByte.ok).toBe(false);
    expect(nullByte.error).toMatch(/control characters/i);

    // Multi-line speech input is valid (align with media route / generator)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { filename: 'speech.mp3' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const multi = await MediaNode.execute(
      ctx({
        config: { mediaType: 'audio', text: 'Hello\nWorld' },
        settings: { SERVER_URL: 'http://localhost:3001' },
      }),
    );
    expect(multi.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/media/generate'),
      expect.objectContaining({
        body: expect.stringContaining('Hello\\nWorld'),
      }),
    );
  });

  it('rejects unknown media type', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'hologram' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown media type/);
  });

  it('starts async video job via /api/media/generate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { jobId: 'mjob_abc', status: 'queued', async: true, surface: 'video' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({
        config: {
          mediaType: 'video',
          prompt: 'drone orbit',
          mediaProvider: 'xai',
        },
        settings: { SERVER_URL: 'http://localhost:3001', SERVER_TOKEN: 'tok' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/mjob_abc/);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/media/generate',
      expect.objectContaining({
        body: expect.stringContaining('"surface":"video"'),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      provider?: string;
    };
    expect(body.provider).toBe('xai');
  });

  it('video without prompt fails closed', async () => {
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'video' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No prompt|prompt/i);
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/generate');
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/generate');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('drops control-char or overlong SERVER_TOKEN (empty Authorization bearer)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    for (const badToken of [`tok${'\n'}en`, `tok${'\0'}en`, 't'.repeat(8_193)]) {
      fetchMock.mockClear();
      await MediaNode.execute(
        ctx({
          config: { mediaType: 'image', prompt: 'a cat' },
          settings: { SERVER_URL: 'http://localhost:3001', SERVER_TOKEN: badToken },
        }),
      );
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ');
    }
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/generate');
  });

  it('falls back to default SERVER_URL when non-http', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'img.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'a cat' },
        settings: { SERVER_URL: 'file:///tmp', SERVER_TOKEN: 'tok' },
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/generate');
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
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/media/generate');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe('a cat');
  });

  it('drops control-char filename/revised prompt and control error strings from API', async () => {
    // Leading control filename/revised must not strip to valid values
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            filename: '\nimg.png',
            revisedPrompt: 'line1\nline2',
          },
        }),
      }),
    );
    const ok = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'a cat' } }),
    );
    expect(ok.ok).toBe(true);
    expect(String(ok.output)).toContain('Image generated:');
    expect(String(ok.output)).not.toContain('img.png');
    // CR/LF in revised prompt collapsed to spaces
    expect(String(ok.output)).toContain('line1 line2');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: '\nquota exceeded' }),
      }),
    );
    const err = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'x' } }),
    );
    expect(err.ok).toBe(false);
    expect(err.error).toBe('Image generation failed');
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
      ok: true,
      json: async () => ({ ok: false, error: 'quota exceeded' }),
    }));
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'image', prompt: 'x' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('quota exceeded');
  });

  it('includes truncated HTTP error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '  bad gateway detail  ',
      }),
    );
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'image', prompt: 'x' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/502/);
    expect(result.error).toContain('bad gateway detail');
  });

  it('scrubs control characters from media HTTP error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => `upstream\nfail${'\0'}ed`,
      }),
    );
    const result = await MediaNode.execute(ctx({ config: { mediaType: 'image', prompt: 'x' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
    expect(result.error).toContain('upstream fail');
    expect(result.error).not.toMatch(/\n/);
    expect(result.error).not.toContain('\0');
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

  it('uses generic image/audio errors when API omits error string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ok: false }),
    }));
    const image = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'x' } }),
    );
    expect(image.ok).toBe(false);
    expect(image.error).toBe('Image generation failed');

    const audio = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'x' } }),
    );
    expect(audio.ok).toBe(false);
    expect(audio.error).toBe('Audio generation failed');
  });

  it('falls back non-http SERVER_URL and stringifies non-Error throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'ok.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'x' },
        settings: { SERVER_URL: 'javascript:alert(1)', SERVER_TOKEN: 't' },
      }),
    );
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^http:\/\/localhost:3001\/api\/media\/generate/);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('boom'));
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'x' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Image generation failed');
  });

  it('defaults blank mediaType to image and omits revised prompt when absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'plain.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: '   ', prompt: 'p' } }),
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toBe('Image generated: plain.png');
    expect(String(result.output)).not.toContain('Revised prompt');
  });

  it('treats control-char mediaType as image default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'ctrl.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio\n', prompt: 'p' } }),
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toMatch(/Image generated/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.prompt).toBe('p');
  });

  it('falls back control-char quality to standard on image requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { filename: 'q.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await MediaNode.execute(
      ctx({
        config: { mediaType: 'image', prompt: 'p', size: '1024x1024', quality: 'hd\n' },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.quality).toBe('standard');
  });

  it('uses status-only audio error when HTTP body is empty after scrub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => '\n\0',
      }),
    );
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hello world' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Audio generation failed: 502');
  });

  it('defaults whitespace-only voice/model and treats non-number status as 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 'oops' as unknown as number,
      text: async () => 'bad',
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await MediaNode.execute(
      ctx({
        config: {
          mediaType: 'audio',
          text: 'hello world',
          voice: '   ',
          model: '   ',
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Audio generation failed: 0/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.voice).toBe('alloy');
    expect(body.model).toBe('tts-1');
  });

  it('falls back when audio fetch throws a control-only Error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('\n\r\0')),
    );
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hello world' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Audio generation failed');
  });

  it('includes audio HTTP error body detail when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => '  rate limited  ',
      }),
    );
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'audio', text: 'hello world' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Audio generation failed: 429: rate limited');
  });

  it('uses status-only image error when HTTP body is empty after scrub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 418,
        text: async () => '',
      }),
    );
    const result = await MediaNode.execute(
      ctx({ config: { mediaType: 'image', prompt: 'teapot' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Image generation failed: 418');
  });
});
