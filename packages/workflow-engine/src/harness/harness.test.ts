import { describe, expect, it } from 'vitest';
import { listHarnesses, registerHarness, resolveHarness } from './index.js';
import type { AgentHarness } from '@neos-work/shared';

describe('harness registry', () => {
  it('lists built-in harnesses', () => {
    const all = listHarnesses();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((h) => h.id && h.name && h.domain)).toBe(true);
  });

  it('filters by domain', () => {
    const coding = listHarnesses('coding');
    const finance = listHarnesses('finance');
    expect(coding.every((h) => h.domain === 'coding')).toBe(true);
    expect(finance.every((h) => h.domain === 'finance')).toBe(true);
  });

  it('resolves built-in harness by id', () => {
    const all = listHarnesses();
    const first = all[0]!;
    expect(resolveHarness(first.id)).toEqual(first);
  });

  it('returns undefined for unknown id', () => {
    expect(resolveHarness('does-not-exist-xyz')).toBeUndefined();
  });

  it('registers custom harnesses', () => {
    const custom: AgentHarness = {
      id: 'test-custom-harness',
      name: 'Test Custom',
      domain: 'general',
      description: 'test',
      systemPrompt: 'You are a test harness.',
      allowedTools: [],
    };
    registerHarness(custom);
    expect(resolveHarness('test-custom-harness')).toMatchObject({ name: 'Test Custom' });
    expect(listHarnesses('general').some((h) => h.id === 'test-custom-harness')).toBe(true);
  });
});
