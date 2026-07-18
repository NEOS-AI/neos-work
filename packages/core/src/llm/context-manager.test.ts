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

  it('compress returns messages unchanged when within recent window', async () => {
    const cm = new ContextManager();
    const messages = Array.from({ length: 5 }, (_, i) => msg('user', `m${i}`));
    const adapter = mockAdapter(['summary']);
    const chatSpy = vi.spyOn(adapter, 'chat');
    const out = await cm.compress(messages, adapter);
    expect(out).toEqual(messages);
    expect(chatSpy).not.toHaveBeenCalled();
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
    expect(out[1].content).toBe('msg-5');
    expect(out[out.length - 1].content).toBe('msg-24');
  });
});
