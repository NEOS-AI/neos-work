import { describe, expect, it } from 'vitest';
import { listHarnesses, registerHarness, resolveHarness } from './index.js';
import { CODING_HARNESSES } from './coding.js';
import { FINANCE_HARNESSES } from './finance.js';
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

  it('rejects control-char ids before trim', () => {
    expect(resolveHarness('bad\nid')).toBeUndefined();
    expect(resolveHarness('\nfinance_analyst')).toBeUndefined();
    expect(resolveHarness(`finance_analyst${'\0'}`)).toBeUndefined();
    // Non-string ids short-circuit
    expect(resolveHarness(null as unknown as string)).toBeUndefined();
    expect(resolveHarness(undefined as unknown as string)).toBeUndefined();
    expect(resolveHarness(123 as unknown as string)).toBeUndefined();
  });

  it('trims id/domain and ignores blank register id', () => {
    const first = listHarnesses()[0]!;
    expect(resolveHarness(`  ${first.id}  `)?.id).toBe(first.id);
    expect(resolveHarness('   ')).toBeUndefined();
    expect(listHarnesses('  coding  ').every((h) => h.domain === 'coding')).toBe(true);
    expect(listHarnesses('   ').length).toBe(listHarnesses().length);
    registerHarness({
      id: '   ',
      name: 'No',
      domain: 'general',
      description: '',
      systemPrompt: 'x',
      allowedTools: [],
    });
    expect(resolveHarness('')).toBeUndefined();

    // register stores trimmed id + field hygiene (use general so coding catalog tests stay pure)
    registerHarness({
      id: '  pad-register-id  ',
      name: '  Padded  ',
      domain: '  GENERAL  ' as never,
      description: '  desc  ',
      systemPrompt: '  prompt  ',
      allowedTools: ['  read  ', '  ', 'write'],
    });
    const reg = resolveHarness('pad-register-id');
    expect(reg?.name).toBe('Padded');
    expect(reg?.domain).toBe('general');
    expect(reg?.description).toBe('desc');
    expect(reg?.systemPrompt).toBe('prompt');
    expect(reg?.allowedTools).toEqual(['read', 'write']);
    expect(resolveHarness('  pad-register-id  ')?.id).toBe('pad-register-id');
    expect(listHarnesses('  GENERAL  ').some((h) => h.id === 'pad-register-id')).toBe(true);

    // blank systemPrompt after trim is a no-op
    registerHarness({
      id: 'blank-prompt-harness',
      name: 'No Prompt',
      domain: 'general',
      description: '',
      systemPrompt: '   ',
      allowedTools: ['read'],
    });
    expect(resolveHarness('blank-prompt-harness')).toBeUndefined();

    // control-char id is rejected; bad tool names filtered
    registerHarness({
      id: 'bad\nid',
      name: 'X',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(resolveHarness('bad\nid')).toBeUndefined();
    // Leading control-char id must not register as stripped id
    registerHarness({
      id: '\nlead-id-h',
      name: 'Lead',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(resolveHarness('lead-id-h')).toBeUndefined();
    // Control-char domain → general; leading-control tools dropped
    registerHarness({
      id: 'ctrl-domain-h',
      name: 'CD',
      domain: '\ncoding' as never,
      description: 'line1\nline2',
      systemPrompt: 'p',
      allowedTools: ['ok', '\nread', 'write'],
    });
    const cd = resolveHarness('ctrl-domain-h');
    expect(cd?.domain).toBe('general');
    expect(cd?.description).toBe('line1 line2');
    expect(cd?.allowedTools).toEqual(['ok', 'write']);
    // Control-char systemPrompt → no-op
    registerHarness({
      id: 'ctrl-prompt-h',
      name: 'CP',
      domain: 'general',
      description: '',
      systemPrompt: 'p\nbad',
      allowedTools: [],
    });
    expect(resolveHarness('ctrl-prompt-h')).toBeUndefined();
    // Control-char domain filter → list all
    expect(listHarnesses('\ncoding').length).toBe(listHarnesses().length);

    registerHarness({
      id: 'tool-filter-h',
      name: 'TF',
      domain: 'general',
      description: 'd'.repeat(3_000),
      systemPrompt: 'p',
      allowedTools: ['ok', 'bad\nt', '', 'x'.repeat(101)],
    });
    const tf = resolveHarness('tool-filter-h');
    expect(tf?.allowedTools).toEqual(['ok']);
    expect(tf?.description?.length).toBe(2_000);
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
    const expectedIds = ['coding_reviewer', 'coding_test_writer', 'coding_refactor'] as const;
    const coding = listHarnesses('coding');
    const ids = coding.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining([...expectedIds]));
    // Only assert built-in catalog entries (registry may also hold custom coding harnesses
    // registered by other test files in the same process).
    for (const id of expectedIds) {
      const h = coding.find((x) => x.id === id);
      expect(h).toBeDefined();
      expect(h!.isBuiltIn).toBe(true);
      expect(h!.systemPrompt.length).toBeGreaterThan(20);
      expect(h!.allowedTools.length).toBeGreaterThan(0);
      expect(h!.constraints?.maxSteps).toBeGreaterThan(0);
    }
  });

  it('includes expected finance harness ids with output schemas', () => {
    const expectedIds = ['finance_analyst', 'finance_risk', 'finance_chart_analyst'] as const;
    const finance = listHarnesses('finance');
    const ids = finance.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining([...expectedIds]));
    for (const id of expectedIds) {
      const h = finance.find((x) => x.id === id);
      expect(h).toBeDefined();
      expect(h!.domain).toBe('finance');
      expect(h!.outputSchema?.type).toBe('object');
      expect(Array.isArray(h!.outputSchema?.required)).toBe(true);
    }
  });

  it('exports coding harness catalog modules with fixed ids and tools', () => {
    expect(CODING_HARNESSES).toHaveLength(3);
    expect(CODING_HARNESSES.map((h) => h.id)).toEqual([
      'coding_reviewer',
      'coding_test_writer',
      'coding_refactor',
    ]);
    expect(CODING_HARNESSES.every((h) => h.domain === 'coding' && h.isBuiltIn)).toBe(true);
    expect(CODING_HARNESSES[0]!.allowedTools).toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'shell']),
    );
    expect(CODING_HARNESSES[0]!.outputSchema?.required).toEqual(
      expect.arrayContaining(['score', 'issues', 'suggestions', 'summary']),
    );
  });

  it('exports finance harness catalog modules with schemas and constraints', () => {
    expect(FINANCE_HARNESSES).toHaveLength(3);
    expect(FINANCE_HARNESSES.map((h) => h.id)).toEqual([
      'finance_analyst',
      'finance_risk',
      'finance_chart_analyst',
    ]);
    expect(FINANCE_HARNESSES.every((h) => h.domain === 'finance' && h.isBuiltIn)).toBe(true);
    expect(FINANCE_HARNESSES[0]!.constraints?.maxSteps).toBe(10);
    expect(FINANCE_HARNESSES[1]!.constraints?.maxSteps).toBe(12);
    expect(FINANCE_HARNESSES[1]!.outputSchema?.required).toEqual(
      expect.arrayContaining(['riskLevel', 'factors', 'mitigations', 'recommendation']),
    );
    expect(FINANCE_HARNESSES[2]!.constraints?.maxSteps).toBe(16);
    expect(FINANCE_HARNESSES[2]!.systemPrompt).toMatch(/TradingView|tv_health_check/i);
    expect(FINANCE_HARNESSES[2]!.outputSchema?.required).toEqual(
      expect.arrayContaining(['symbol', 'structure', 'bias', 'confidence', 'riskNotes']),
    );
  });

  it('has unique harness ids across all domains', () => {
    const all = listHarnesses();
    const ids = all.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps description/systemPrompt and maps invalid domains to general', () => {
    registerHarness({
      id: 'cov_harness_caps',
      name: 'Caps',
      domain: 'quantum' as never,
      description: 'D'.repeat(10_000),
      systemPrompt: 'S'.repeat(120_000),
      allowedTools: ['read_file', ...Array.from({ length: 50 }, (_, i) => `tool_${i}`)],
    });
    const h = resolveHarness('cov_harness_caps');
    expect(h).toBeDefined();
    expect(h!.domain).toBe('general');
    expect(h!.description!.length).toBe(2_000);
    expect(h!.systemPrompt.length).toBe(100_000);
    expect(h!.allowedTools.length).toBeLessThanOrEqual(100);

    // Control-char description collapsed; non-string description preserved as-is path
    registerHarness({
      id: 'cov_harness_desc_ctrl',
      name: 'DescCtrl',
      domain: 'coding',
      description: `line1\nline2${'\0'}x`,
      systemPrompt: 'ok prompt',
      allowedTools: [],
    });
    const d = resolveHarness('cov_harness_desc_ctrl');
    expect(d?.description).toBe('line1 line2 x');
    expect(d?.description).not.toMatch(/[\r\n\0]/);

    // Reject control-char systemPrompt entirely
    registerHarness({
      id: 'cov_harness_bad_prompt',
      name: 'Bad',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'bad\nprompt',
      allowedTools: [],
    });
    expect(resolveHarness('cov_harness_bad_prompt')).toBeUndefined();

    // Non-string description preserved; non-array allowedTools → []
    registerHarness({
      id: 'cov_harness_nonstr_desc',
      name: 'NonStrDesc',
      domain: 'coding',
      description: 99 as never,
      systemPrompt: 'prompt ok',
      allowedTools: 'read_file' as never,
    });
    const ns = resolveHarness('cov_harness_nonstr_desc');
    expect(ns?.description).toBe(99 as never);
    expect(ns?.allowedTools).toEqual([]);
  });
});
