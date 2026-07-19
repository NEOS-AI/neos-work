import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS } from '@neos-work/shared';
import { AnthropicAdapter } from './anthropic.js';

describe('AnthropicAdapter', () => {
  it('exposes provider id/name and shared model catalog', () => {
    const adapter = new AnthropicAdapter('sk-test');
    expect(adapter.id).toBe('anthropic');
    expect(adapter.name).toBe('Anthropic');
    expect(adapter.getModels()).toEqual(ANTHROPIC_MODELS);
    expect(adapter.getModels().length).toBeGreaterThan(0);
  });
});
