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

describe('built-in coding and finance harness catalogs', () => {
  it('includes expected coding harness ids with tools and constraints', () => {
    const coding = listHarnesses('coding');
    const ids = coding.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['coding_reviewer', 'coding_test_writer', 'coding_refactor']));
    for (const h of coding) {
      expect(h.isBuiltIn).toBe(true);
      expect(h.systemPrompt.length).toBeGreaterThan(20);
      expect(h.allowedTools.length).toBeGreaterThan(0);
      expect(h.constraints?.maxSteps).toBeGreaterThan(0);
    }
  });

  it('includes expected finance harness ids with output schemas', () => {
    const finance = listHarnesses('finance');
    const ids = finance.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['finance_analyst', 'finance_risk']));
    for (const h of finance) {
      expect(h.domain).toBe('finance');
      expect(h.outputSchema?.type).toBe('object');
      expect(Array.isArray(h.outputSchema?.required)).toBe(true);
    }
  });

  it('has unique harness ids across all domains', () => {
    const all = listHarnesses();
    const ids = all.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
