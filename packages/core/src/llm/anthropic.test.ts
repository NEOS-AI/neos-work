import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_MODELS } from '@neos-work/shared';

const streamMock = vi.fn();
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      stream: (...args: unknown[]) => streamMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    };
    constructor(_opts: { apiKey: string }) {}
  }
  return { default: Anthropic };
});

const { AnthropicAdapter } = await import('./anthropic.js');

async function* events(list: unknown[]) {
  for (const e of list) yield e;
}

afterEach(() => {
  streamMock.mockReset();
  createMock.mockReset();
});

describe('AnthropicAdapter', () => {
  it('exposes provider id/name and shared model catalog', () => {
    const adapter = new AnthropicAdapter('sk-test');
    expect(adapter.id).toBe('anthropic');
    expect(adapter.name).toBe('Anthropic');
    expect(adapter.getModels()).toEqual(ANTHROPIC_MODELS);
    expect(adapter.getModels().length).toBeGreaterThan(0);
  });

  it('chat streams text, thinking, tool_use, and done', async () => {
    streamMock.mockReturnValue(
      events([
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu1', name: 'echo' },
        },
        {
          type: 'content_block_delta',
          delta: { partial_json: '{"x":' },
        },
        {
          type: 'content_block_delta',
          delta: { partial_json: '1}' },
        },
        { type: 'content_block_stop' },
        {
          type: 'content_block_delta',
          delta: { text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          delta: { thinking: 'ponder' },
        },
      ]),
    );

    const adapter = new AnthropicAdapter('sk-stream');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'claude-sonnet-4-20250514',
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
      thinkingMode: 'high',
      maxTokens: 128,
    })) {
      chunks.push(c);
    }

    expect(chunks).toEqual([
      {
        type: 'tool_use',
        toolUseId: 'tu1',
        toolName: 'echo',
        toolInput: { x: 1 },
      },
      { type: 'text', content: 'Hello' },
      { type: 'thinking', content: 'ponder' },
      { type: 'done' },
    ]);

    expect(streamMock).toHaveBeenCalled();
    const [params] = streamMock.mock.calls[0] as [Record<string, unknown>];
    expect(params.model).toBe('claude-sonnet-4-20250514');
    expect(params.stream).toBe(true);
    expect(params.system).toBe('sys');
    expect(params.tools).toEqual([
      {
        name: 'echo',
        description: 'echo',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
    expect(params.thinking).toEqual({
      type: 'enabled',
      budget_tokens: expect.any(Number),
    });
    expect((params.max_tokens as number) > 128).toBe(true);
  });

  it('chat wraps invalid tool JSON as _raw fallback', async () => {
    streamMock.mockReturnValue(
      events([
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu2', name: 'bad' },
        },
        {
          type: 'content_block_delta',
          delta: { partial_json: 'not-json' },
        },
        { type: 'content_block_stop' },
      ]),
    );

    const adapter = new AnthropicAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      chunks.push(c);
    }

    expect(chunks[0]).toEqual({
      type: 'tool_use',
      toolUseId: 'tu2',
      toolName: 'bad',
      toolInput: { _raw: 'not-json' },
    });
  });

  it('chat yields empty tool input object when no partial_json', async () => {
    streamMock.mockReturnValue(
      events([
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu3', name: 'noop' },
        },
        { type: 'content_block_stop' },
      ]),
    );

    const adapter = new AnthropicAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      chunks.push(c);
    }

    expect(chunks[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'noop',
      toolInput: {},
    });
  });

  it('chat yields error when stream throws', async () => {
    streamMock.mockImplementation(() => {
      throw new Error('stream down');
    });

    const adapter = new AnthropicAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'error', content: 'stream down' }]);
  });

  it('chat yields error for non-Error throws', async () => {
    streamMock.mockImplementation(() => {
      throw 'boom';
    });

    const adapter = new AnthropicAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'error', content: 'Unknown error' }]);
  });

  it('validateApiKey returns true on success and false on failure', async () => {
    createMock.mockResolvedValueOnce({});
    const adapter = new AnthropicAdapter('sk');
    await expect(adapter.validateApiKey('good')).resolves.toBe(true);

    createMock.mockRejectedValueOnce(new Error('401'));
    await expect(adapter.validateApiKey('bad')).resolves.toBe(false);
    await expect(adapter.validateApiKey('   ')).resolves.toBe(false);
  });

  it('rejects blank/whitespace api keys in constructor', () => {
    expect(() => new AnthropicAdapter('   ')).toThrow(/ANTHROPIC_API_KEY/i);
    expect(() => new AnthropicAdapter('')).toThrow(/ANTHROPIC_API_KEY/i);
  });
});
