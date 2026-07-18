import { afterEach, describe, expect, it } from 'vitest';
import {
  createCustomHarness,
  deleteCustomHarness,
  getCustomHarness,
  listCustomHarnesses,
  updateCustomHarness,
} from './harnesses.js';

const ID = '_cov_harness_1';

afterEach(() => {
  try { deleteCustomHarness(ID); } catch { /* ignore */ }
});

describe('custom harnesses CRUD', () => {
  it('creates, lists, updates, deletes', () => {
    const h = createCustomHarness({
      id: ID,
      name: 'Cov Harness',
      domain: 'coding',
      description: 'test harness',
      systemPrompt: 'You are a test agent',
      allowedTools: ['read', 'write'],
      constraints: { maxSteps: 5 },
    });
    expect(h.isBuiltIn).toBe(false);
    expect(getCustomHarness(ID)?.allowedTools).toEqual(['read', 'write']);
    expect(listCustomHarnesses().some((x) => x.id === ID)).toBe(true);

    const updated = updateCustomHarness(ID, {
      name: 'Renamed Harness',
      allowedTools: ['read'],
      constraints: { maxSteps: 10 },
    });
    expect(updated?.name).toBe('Renamed Harness');
    expect(updated?.allowedTools).toEqual(['read']);
    expect(updated?.constraints).toEqual({ maxSteps: 10 });
    // partial update keeps systemPrompt
    expect(updated?.systemPrompt).toBe('You are a test agent');

    expect(updateCustomHarness('missing', { name: 'x' })).toBeUndefined();
    expect(deleteCustomHarness(ID)).toBe(true);
    expect(getCustomHarness(ID)).toBeUndefined();
    expect(deleteCustomHarness(ID)).toBe(false);
  });

  it('supports finance domain harness and empty tools', () => {
    const id = '_cov_harness_fin';
    try {
      const h = createCustomHarness({
        id,
        name: 'Finance Cov',
        domain: 'finance',
        description: 'fin',
        systemPrompt: 'Analyze markets',
        allowedTools: [],
      });
      expect(h.domain).toBe('finance');
      expect(h.allowedTools).toEqual([]);
      expect(listCustomHarnesses().some((x) => x.id === id && x.domain === 'finance')).toBe(true);
    } finally {
      deleteCustomHarness(id);
    }
  });
});

