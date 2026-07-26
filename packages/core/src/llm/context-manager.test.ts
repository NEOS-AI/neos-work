import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@neos-work/shared';
import { ContextManager } from './context-manager.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';

function msg(role: Message['role'], content: Message['content']): Message {
  return { role, content };
}

describe('ContextManager', () => {
  it('needsCompression uses char/4 estimate against threshold', () => {
    const cm = new ContextManager(10);
    expect(cm.needsCompression([msg('user', 'hi')])).toBe(false);
    // 44 chars => 11 tokens > 10
    expect(cm.needsCompression([msg('user', 'x'.repeat(44))])).toBe(true);
    expect(cm.needsCompression([])).toBe(false);
  });

  it('clamps invalid threshold to default', () => {
    const bad = new ContextManager(Number.NaN);
    // default threshold 80k: small message not compressed
    expect(bad.needsCompression([msg('user', 'hi')])).toBe(false);
    // oversized threshold clamps to max
    const big = new ContextManager(9e12);
    expect(big.needsCompression([msg('user', 'x'.repeat(100))])).toBe(false);
  });

  it('counts text blocks in multimodal content', () => {
    const cm = new ContextManager(5);
    const messages = [
      msg('user', [
        { type: 'text', text: 'a'.repeat(40) },
      ]),
    ];
    expect(cm.needsCompression(messages)).toBe(true);
  });

  it('ignores non-text multimodal blocks for token estimate', () => {
    const cm = new ContextManager(5);
    const messages = [
      msg('user', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x'.repeat(1000) } } as never,
      ]),
    ];
    // no text → 0 tokens → no compression
    expect(cm.needsCompression(messages)).toBe(false);
  });

  it('compress returns messages unchanged when within recent window', async () => {
    const cm = new ContextManager();
    const messages = Array.from({ length: 5 }, (_, i) => msg('user', `m${i}`));
    const adapter = mockAdapter(['summary']);
    const chatSpy = vi.spyOn(adapter, 'chat');
    const out = await cm.compress(messages, adapter);
    expect(out).toEqual(messages);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('summarize truncates oversized message content in transcript', async () => {
    const cm = new ContextManager(1); // force compression path via low threshold
    const messages = Array.from({ length: 25 }, (_, i) =>
      msg('user', i < 5 ? 'x'.repeat(8_000) : `m${i}`),
    );
    const adapter = mockAdapter(['summary-ok']);
    const chat = adapter.chat.bind(adapter);
    let captured = '';
    adapter.chat = async function* (params) {
      captured = JSON.stringify(params.messages);
      yield* chat(params);
    };
    const out = await cm.compress(messages, adapter);
    expect(out[0]?.role).toBe('system');
    expect(String(out[0]?.content ?? '')).toContain('summary-ok');
    // Per-message body was truncated with ellipsis marker in the summarize prompt
    expect(captured).toContain('…');
  });

  it('caps overall transcript length before calling the model', async () => {
    const cm = new ContextManager();
    // 40 older messages with long bodies → transcript exceeds 100k
    const older = Array.from({ length: 40 }, (_, i) =>
      msg('user', `block-${i}-` + 'Y'.repeat(4_000)),
    );
    const recent = Array.from({ length: 20 }, (_, i) => msg('assistant', `r${i}`));
    const messages = [...older, ...recent];

    let capturedPrompt = '';
    const adapter = mockAdapter(['capped-summary']);
    const base = adapter.chat.bind(adapter);
    adapter.chat = async function* (params) {
      capturedPrompt = String(params.messages?.[0]?.content ?? '');
      yield* base(params);
    };
    const out = await cm.compress(messages, adapter);
    expect(out[0]?.role).toBe('system');
    expect(capturedPrompt).toContain('[transcript truncated]');
    // Prompt body stays bounded (header + 100k transcript + marker)
    expect(capturedPrompt.length).toBeLessThan(120_000);
  });

  it('compress summarizes older messages and keeps recent 20', async () => {
    const cm = new ContextManager();
    const messages = Array.from({ length: 25 }, (_, i) => msg('user', `msg-${i}`));
    const adapter = mockAdapter(['older summary']);
    const out = await cm.compress(messages, adapter);
    expect(out).toHaveLength(21); // 1 summary + 20 recent
    expect(out[0]).toEqual({
      role: 'system',
      content: '[이전 대화 요약]\nolder summary',
    });
    expect(out[1]!.content).toBe('msg-5');
    expect(out[out.length - 1]!.content).toBe('msg-24');
  });

  it('compress stringifies multimodal older messages in transcript', async () => {
    const cm = new ContextManager();
    const older = Array.from({ length: 5 }, (_, i) =>
      msg('user', [{ type: 'text', text: `old-${i}` }]),
    );
    const recent = Array.from({ length: 20 }, (_, i) => msg('assistant', `recent-${i}`));
    const messages = [...older, ...recent];

    let captured = '';
    const adapter = mockAdapter(['sum']);
    const base = adapter.chat.bind(adapter);
    adapter.chat = async function* (params) {
      captured = JSON.stringify(params.messages);
      yield* base(params);
    };

    const out = await cm.compress(messages, adapter);
    expect(out[0]!.content).toContain('sum');
    expect(captured).toContain('old-0');
    // multimodal content is JSON.stringified in transcript
    expect(captured).toContain('type');
  });

  it('compress at exactly RECENT_WINDOW does not summarize', async () => {
    const cm = new ContextManager();
    const messages = Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`));
    const adapter = mockAdapter(['should-not-run']);
    const spy = vi.spyOn(adapter, 'chat');
    const out = await cm.compress(messages, adapter);
    expect(out).toEqual(messages);
    expect(spy).not.toHaveBeenCalled();
  });

  it('clamps invalid threshold and ignores empty message lists', () => {
    const cmNaN = new ContextManager(Number.NaN);
    // default threshold is high; short message does not compress
    expect(cmNaN.needsCompression([msg('user', 'hi')])).toBe(false);

    const cmZero = new ContextManager(0);
    // clamped to min 1; 8 chars => 2 tokens > 1
    expect(cmZero.needsCompression([msg('user', 'xxxxxxxx')])).toBe(true);

    const cm = new ContextManager(10);
    expect(cm.needsCompression([])).toBe(false);
    expect(cm.needsCompression(null as never)).toBe(false);
  });

  it('scrubs control-char roles and null bytes from summarize transcript', async () => {
    const cm = new ContextManager();
    const older = Array.from({ length: 5 }, (_, i) => {
      if (i === 0) {
        return {
          role: `user${'\n'}evil` as Message['role'],
          content: `secret${'\0'}payload`,
        };
      }
      return msg('user', `old-${i}`);
    });
    const recent = Array.from({ length: 20 }, (_, i) => msg('assistant', `recent-${i}`));
    const messages = [...older, ...recent];

    let captured = '';
    const adapter = mockAdapter(['sum']);
    const base = adapter.chat.bind(adapter);
    adapter.chat = async function* (params) {
      captured = String(params.messages?.[0]?.content ?? '');
      yield* base(params);
    };

    await cm.compress(messages, adapter);
    // Control-char role falls back to "unknown"
    expect(captured).toContain('unknown: secretpayload');
    expect(captured).not.toContain('user\n');
    expect(captured).not.toContain('\0');
  });

  it('scrubs null bytes from model summary output while keeping multi-line text', async () => {
    const cm = new ContextManager();
    const messages = Array.from({ length: 25 }, (_, i) => msg('user', `msg-${i}`));
    // Model returns null-byte + newlines in the summary chunk
    const adapter = mockAdapter([`line1${'\0'}mid\nline2`]);
    const out = await cm.compress(messages, adapter);
    expect(out[0]?.role).toBe('system');
    const content = String(out[0]?.content ?? '');
    expect(content).toContain('line1mid');
    expect(content).toContain('line2');
    expect(content).not.toContain('\0');
    // Multi-line summaries are allowed (only null bytes stripped)
    expect(content).toMatch(/line1mid\nline2/);
  });

  it('handles non-array compress input, blank roles, empty models, overlong summary', async () => {
    const cm = new ContextManager();
    // Non-array messages → []
    await expect(cm.compress(null as never, mockAdapter(['x']))).resolves.toEqual([]);
    await expect(cm.compress(undefined as never, mockAdapter(['x']))).resolves.toEqual([]);

    // Whitespace-only role → "unknown" after trim
    const older = Array.from({ length: 5 }, (_, i) => {
      if (i === 0) {
        return { role: '   ' as Message['role'], content: 'blank-role-body' };
      }
      return msg('user', `old-${i}`);
    });
    const recent = Array.from({ length: 20 }, (_, i) => msg('assistant', `r${i}`));
    let captured = '';
    let modelUsed = 'unset';
    const adapter = {
      id: 'openai' as const,
      name: 'Mock',
      getModels: () => [] as Array<{ id: string }>,
      async *chat(params: { model?: string; messages?: Array<{ content?: string }> }) {
        modelUsed = params.model ?? '';
        captured = String(params.messages?.[0]?.content ?? '');
        // Stream summary past SUMMARY_MAX (8_000) to hit break + final slice paths
        yield { type: 'text' as const, content: 'S'.repeat(5_000) };
        yield { type: 'text' as const, content: 'T'.repeat(5_000) };
        yield { type: 'done' as const };
      },
      async validateApiKey() {
        return true;
      },
    };
    const out = await cm.compress([...older, ...recent], adapter as never);
    expect(modelUsed).toBe(''); // empty getModels → model id ''
    expect(captured).toContain('unknown: blank-role-body');
    expect(out[0]?.role).toBe('system');
    // Summary capped at 8_000 after scrub
    const summaryBody = String(out[0]?.content ?? '').replace('[이전 대화 요약]\n', '');
    expect(summaryBody.length).toBeLessThanOrEqual(8_000);
  });
});
