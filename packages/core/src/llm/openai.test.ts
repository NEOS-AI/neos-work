import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_MODELS, OLLAMA_PRESET_MODELS } from '@neos-work/shared';
import { OpenAIAdapter } from './openai.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAIAdapter', () => {
  it('uses OpenAI identity and model catalog by default', () => {
    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk-test' });
    expect(adapter.id).toBe('openai');
    expect(adapter.name).toBe('OpenAI');
    expect(adapter.getModels()).toEqual(OPENAI_MODELS);
  });

  it('trims apiKey/baseUrl and strips trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIAdapter({
      provider: 'openai',
      apiKey: '  sk-x  ',
      baseUrl: '  https://example.test/v1/  ',
    });
    await expect(adapter.validateApiKey('  sk-check  ')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-check' },
      }),
    );
    await expect(adapter.validateApiKey('   ')).resolves.toBe(false);
  });

  it('falls back to default baseUrl for non-http custom URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIAdapter({
      provider: 'openai',
      apiKey: 'sk',
      baseUrl: 'file:///etc/passwd',
    });
    await adapter.validateApiKey('sk');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.anything(),
    );
  });

  it('uses Ollama identity, models, and default base URL', () => {
    const adapter = new OpenAIAdapter({ provider: 'ollama' });
    expect(adapter.id).toBe('ollama');
    expect(adapter.name).toBe('Ollama');
    expect(adapter.getModels()).toEqual(OLLAMA_PRESET_MODELS);
  });

  it('validateApiKey always succeeds for ollama', async () => {
    const adapter = new OpenAIAdapter({ provider: 'ollama' });
    await expect(adapter.validateApiKey('')).resolves.toBe(true);
  });

  it('validateApiKey checks /models for openai and returns ok status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIAdapter({
      provider: 'openai',
      apiKey: 'sk-x',
      baseUrl: 'https://example.test/v1',
    });
    await expect(adapter.validateApiKey('sk-check')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-check' },
      }),
    );
  });

  it('validateApiKey returns false on non-ok or network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk' });
    await expect(adapter.validateApiKey('bad')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(adapter.validateApiKey('bad')).resolves.toBe(false);
  });

  it('chat yields error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk' });
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { type: 'error', content: 'OpenAI request failed: down' },
    ]);
  });

  it('chat yields error when response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
        body: null,
      }),
    );
    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk' });
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks[0]).toMatchObject({
      type: 'error',
      content: expect.stringContaining('401'),
    });
  });

  it('chat streams text deltas and done', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAIAdapter({
      provider: 'openai',
      apiKey: 'sk-stream',
      baseUrl: 'https://api.example/v1',
    });
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        {
          name: 'echo',
          description: 'echo',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      maxTokens: 128,
    })) {
      chunks.push(c);
    }

    expect(chunks).toEqual([
      { type: 'text', content: 'Hel' },
      { type: 'text', content: 'lo' },
      { type: 'done' },
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(128);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'echo',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-stream');
  });

  it('chat yields tool_use when finish_reason is tool_calls', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"x\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body: stream }),
    );

    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk' });
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'run' }],
    })) {
      chunks.push(c);
    }

    expect(chunks).toContainEqual({
      type: 'tool_use',
      toolUseId: 'call_1',
      toolName: 'echo',
      toolInput: { x: 1 },
    });
    expect(chunks.at(-1)).toEqual({ type: 'done' });
  });

  it('chat yields empty body error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body: null }),
    );
    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk' });
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'error', content: 'Empty response body' }]);
  });
});
