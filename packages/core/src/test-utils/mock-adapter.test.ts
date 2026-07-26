import { describe, expect, it } from 'vitest';
import { mockAdapter } from './mock-adapter.js';

describe('mockAdapter', () => {
  it('yields sequential text responses and done', async () => {
    const adapter = mockAdapter(['one', 'two']);
    const chunks1 = [];
    for await (const c of adapter.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks1.push(c);
    }
    expect(chunks1).toEqual([
      { type: 'text', content: 'one' },
      { type: 'done' },
    ]);

    const chunks2 = [];
    for await (const c of adapter.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks2.push(c);
    }
    expect(chunks2).toEqual([
      { type: 'text', content: 'two' },
      { type: 'done' },
    ]);
  });

  it('validateApiKey always returns true and honors opts', async () => {
    const adapter = mockAdapter([''], {
      id: 'anthropic',
      models: [
        {
          id: 'custom',
          name: 'Custom',
          providerId: 'anthropic',
          contextWindow: 1000,
          supportsThinking: false,
          supportsTools: false,
          supportsVision: false,
        },
      ],
    });
    expect(adapter.id).toBe('anthropic');
    expect(adapter.getModels()[0]?.id).toBe('custom');
    await expect(adapter.validateApiKey('anything')).resolves.toBe(true);
  });

  it('skips empty text responses and still yields done', async () => {
    const adapter = mockAdapter(['']);
    const chunks = [];
    for await (const c of adapter.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'done' }]);
  });
});
