import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_MODELS } from '@neos-work/shared';

const generateContentStream = vi.fn();
const generateContent = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContentStream: (...args: unknown[]) => generateContentStream(...args),
      generateContent: (...args: unknown[]) => generateContent(...args),
    };
    constructor(_opts: { apiKey: string }) {}
  }
  return { GoogleGenAI };
});

const { GoogleAdapter } = await import('./google.js');

async function* streamOf(chunks: unknown[]) {
  for (const c of chunks) yield c;
}

afterEach(() => {
  generateContentStream.mockReset();
  generateContent.mockReset();
});

describe('GoogleAdapter', () => {
  it('exposes provider id/name and shared model catalog', () => {
    const adapter = new GoogleAdapter('sk-test');
    expect(adapter.id).toBe('google');
    expect(adapter.name).toBe('Google AI');
    expect(adapter.getModels()).toEqual(GOOGLE_MODELS);
    expect(adapter.getModels().length).toBeGreaterThan(0);
  });

  it('chat streams text, thinking, tool_use, and done', async () => {
    generateContentStream.mockResolvedValue(
      streamOf([
        {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'thinking…' },
                  { text: 'Hello' },
                  {
                    functionCall: {
                      name: 'echo',
                      args: { msg: 'hi' },
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [{ content: { parts: [] } }],
        },
        {
          // no candidates — skipped
        },
      ]),
    );

    const adapter = new GoogleAdapter('sk-stream');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'prev' },
      ],
      tools: [
        {
          name: 'echo',
          description: 'echo',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
        },
      ],
      thinkingMode: 'high',
      maxTokens: 256,
    })) {
      chunks.push(c);
    }

    expect(chunks).toEqual([
      { type: 'thinking', content: 'thinking…' },
      { type: 'text', content: 'Hello' },
      {
        type: 'tool_use',
        toolName: 'echo',
        toolInput: { msg: 'hi' },
      },
      { type: 'done' },
    ]);

    expect(generateContentStream).toHaveBeenCalled();
    const [req] = generateContentStream.mock.calls[0] as [Record<string, unknown>];
    expect(req.model).toBe('gemini-2.0-flash');
    expect(req.config).toMatchObject({
      maxOutputTokens: 256,
      systemInstruction: 'sys',
      thinkingConfig: { thinkingBudget: expect.any(Number) },
    });
    expect((req.config as { tools: unknown[] }).tools).toHaveLength(1);
    const contents = req.contents as Array<{ role: string }>;
    expect(contents[0]?.role).toBe('user');
    expect(contents[1]?.role).toBe('model');
  });

  it('chat omits thinking and tools when not requested', async () => {
    generateContentStream.mockResolvedValue(
      streamOf([
        {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        },
      ]),
    );

    const adapter = new GoogleAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      thinkingMode: 'none',
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { type: 'text', content: 'ok' },
      { type: 'done' },
    ]);

    const [req] = generateContentStream.mock.calls[0] as [Record<string, unknown>];
    expect((req.config as { thinkingConfig?: unknown }).thinkingConfig).toBeUndefined();
    expect((req.config as { tools?: unknown }).tools).toBeUndefined();
  });

  it('chat yields empty function args as object', async () => {
    generateContentStream.mockResolvedValue(
      streamOf([
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'noop' } }],
              },
            },
          ],
        },
      ]),
    );

    const adapter = new GoogleAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      chunks.push(c);
    }
    expect(chunks[0]).toEqual({
      type: 'tool_use',
      toolName: 'noop',
      toolInput: {},
    });
  });

  it('chat yields error when stream fails', async () => {
    generateContentStream.mockRejectedValue(new Error('quota'));
    const adapter = new GoogleAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'error', content: 'quota' }]);
  });

  it('chat yields Unknown error for non-Error throws', async () => {
    generateContentStream.mockRejectedValue(42);
    const adapter = new GoogleAdapter('sk');
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'error', content: 'Unknown error' }]);
  });

  it('validateApiKey returns true on success and false on failure', async () => {
    generateContent.mockResolvedValueOnce({});
    const adapter = new GoogleAdapter('sk');
    await expect(adapter.validateApiKey('good')).resolves.toBe(true);

    generateContent.mockRejectedValueOnce(new Error('401'));
    await expect(adapter.validateApiKey('bad')).resolves.toBe(false);
  });
});
