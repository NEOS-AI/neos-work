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

  it('rejects blank, control-char, or overlong API keys', () => {
    expect(() => new GoogleAdapter('')).toThrow(/GOOGLE_API_KEY is required/i);
    expect(() => new GoogleAdapter('   ')).toThrow(/GOOGLE_API_KEY is required/i);
    expect(() => new GoogleAdapter(`sk${'\n'}bad`)).toThrow(/GOOGLE_API_KEY is required/i);
    expect(() => new GoogleAdapter(`sk${'\0'}bad`)).toThrow(/GOOGLE_API_KEY is required/i);
    expect(() => new GoogleAdapter('k'.repeat(8_193))).toThrow(/GOOGLE_API_KEY is required/i);
    expect(() => new GoogleAdapter('  sk-ok  ')).not.toThrow();
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

  it('falls back to catalog model and truncates oversized system/user content', async () => {
    generateContentStream.mockResolvedValue(streamOf([]));
    const adapter = new GoogleAdapter('sk');
    const catalogId = adapter.getModels()[0]?.id;

    for await (const _ of adapter.chat({
      model: 'x'.repeat(201),
      messages: [
        { role: 'system', content: 'S'.repeat(100_001) },
        { role: 'user', content: 'U'.repeat(500_001) },
      ],
    })) {
      /* drain */
    }
    const req = generateContentStream.mock.calls[0] as [Record<string, unknown>];
    expect(req[0].model).toBe(catalogId);
    const cfg = req[0].config as { systemInstruction?: string };
    expect(String(cfg.systemInstruction).length).toBe(100_000);
    const contents = req[0].contents as Array<{ parts: Array<{ text: string }> }>;
    expect(contents[0]!.parts[0]!.text).toContain('…[truncated]');
    expect(contents[0]!.parts[0]!.text.length).toBeLessThanOrEqual(500_000 + 20);
  });

  it('clamps invalid maxTokens to default 4096 and caps huge values', async () => {
    generateContentStream.mockResolvedValue(streamOf([]));
    const adapter = new GoogleAdapter('sk');

    for await (const _ of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: Number.NaN,
    })) {
      /* drain */
    }
    let req = generateContentStream.mock.calls[0] as [Record<string, unknown>];
    expect((req[0].config as { maxOutputTokens: number }).maxOutputTokens).toBe(4096);

    generateContentStream.mockResolvedValue(streamOf([]));
    for await (const _ of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 999_999,
    })) {
      /* drain */
    }
    req = generateContentStream.mock.calls[1] as [Record<string, unknown>];
    expect((req[0].config as { maxOutputTokens: number }).maxOutputTokens).toBe(128_000);

    generateContentStream.mockResolvedValue(streamOf([]));
    for await (const _ of adapter.chat({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: -5,
    })) {
      /* drain */
    }
    req = generateContentStream.mock.calls[2] as [Record<string, unknown>];
    expect((req[0].config as { maxOutputTokens: number }).maxOutputTokens).toBe(4096);
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
    await expect(adapter.validateApiKey('   ')).resolves.toBe(false);
  });

  it('rejects blank/whitespace api keys in constructor', () => {
    expect(() => new GoogleAdapter('   ')).toThrow(/GOOGLE_API_KEY/i);
    expect(() => new GoogleAdapter('')).toThrow(/GOOGLE_API_KEY/i);
  });
});
