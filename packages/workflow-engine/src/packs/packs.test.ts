import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PACK_IDS,
  isBuiltInPackId,
  listPacks,
  listWorkers,
  registerWorker,
  resolvePack,
  resolveWorker,
} from './index.js';
import { FINANCE_WORKERS } from './finance.js';
import { CODING_WORKERS } from './coding.js';
import { RESEARCH_WORKERS } from './research.js';
import { GENERAL_WORKERS } from './general.js';

describe('domain pack registry', () => {
  it('exposes four built-in packs (Q4 research included)', () => {
    expect([...BUILT_IN_PACK_IDS]).toEqual(['finance', 'coding', 'research', 'general']);
    const packs = listPacks();
    expect(packs).toHaveLength(4);
    expect(packs.every((p) => p.isBuiltIn)).toBe(true);
    expect(packs.map((p) => p.id).sort()).toEqual(
      ['coding', 'finance', 'general', 'research'].sort(),
    );
  });

  it('resolves pack detail with workers and block ids', () => {
    const finance = resolvePack('finance');
    expect(finance).toBeDefined();
    expect(finance!.blockIds).toEqual(
      expect.arrayContaining(['price_lookup', 'portfolio_summary', 'risk_report']),
    );
    expect(finance!.workers.map((w) => w.id)).toEqual(
      expect.arrayContaining([
        'finance_analyst',
        'finance_risk',
        'finance_chart_analyst',
        'finance_portfolio',
      ]),
    );

    const research = resolvePack('  research  ');
    expect(research?.workers.map((w) => w.id)).toEqual(
      expect.arrayContaining(['research_web', 'research_synthesizer']),
    );

    expect(resolvePack('unknown-pack')).toBeUndefined();
    expect(resolvePack('bad\nid')).toBeUndefined();
    expect(resolvePack('')).toBeUndefined();
    expect(resolvePack(null as unknown as string)).toBeUndefined();
  });

  it('lists and resolves workers; unknown id is undefined', () => {
    const all = listWorkers();
    expect(all.length).toBeGreaterThanOrEqual(12); // 4+4+2+2 built-ins
    expect(all.every((w) => w.id && w.domain && w.systemPrompt)).toBe(true);

    expect(resolveWorker('finance_analyst')?.name).toMatch(/분석/);
    expect(resolveWorker('  coding_implementer  ')?.permissionProfile).toBe('execute');
    expect(resolveWorker('general_coordinator')?.defaultMode).toBe('coordinator');
    expect(resolveWorker('does-not-exist-xyz')).toBeUndefined();
    expect(resolveWorker('bad\nid')).toBeUndefined();
    expect(resolveWorker(null as unknown as string)).toBeUndefined();
  });

  it('filters workers by domain pack id', () => {
    expect(listWorkers('research').every((w) => w.domain === 'research')).toBe(true);
    expect(listWorkers('coding').map((w) => w.id)).toEqual(
      expect.arrayContaining(['coding_reviewer', 'coding_implementer']),
    );
    // control-char domain → all
    expect(listWorkers('\ncoding').length).toBe(listWorkers().length);
  });

  it('registers custom workers with field hygiene; maps unknown domain to general', () => {
    registerWorker({
      id: '  pack-custom-worker  ',
      name: '  Custom  ',
      domain: 'quantum' as never,
      description: 'line1\nline2',
      systemPrompt: '  You are custom.  ',
      allowedTools: ['  read_file  ', '', 'bad\nt', 'ok'],
      permissionProfile: 'read_only',
      workspace: { kind: 'isolated' },
      defaultMode: 'solo',
    });
    const w = resolveWorker('pack-custom-worker');
    expect(w).toMatchObject({
      name: 'Custom',
      domain: 'general',
      description: 'line1 line2',
      systemPrompt: 'You are custom.',
      allowedTools: ['read_file', 'ok'],
      permissionProfile: 'read_only',
      workspace: { kind: 'isolated' },
      defaultMode: 'solo',
      isBuiltIn: false,
    });

    // blank systemPrompt / control-char id rejected
    registerWorker({
      id: 'blank-prompt-w',
      name: 'B',
      domain: 'general',
      description: '',
      systemPrompt: '   ',
      allowedTools: [],
    });
    expect(resolveWorker('blank-prompt-w')).toBeUndefined();
    registerWorker({
      id: '\nlead-w',
      name: 'L',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
    });
    expect(resolveWorker('lead-w')).toBeUndefined();
  });

  it('isBuiltInPackId recognizes the four packs', () => {
    expect(isBuiltInPackId('finance')).toBe(true);
    expect(isBuiltInPackId(' Research ')).toBe(true);
    expect(isBuiltInPackId('quantum')).toBe(false);
    expect(isBuiltInPackId('')).toBe(false);
  });
});

describe('built-in worker catalogs (pack modules)', () => {
  it('finance workers include portfolio + profiles', () => {
    expect(FINANCE_WORKERS).toHaveLength(4);
    expect(FINANCE_WORKERS.map((w) => w.id)).toEqual([
      'finance_analyst',
      'finance_risk',
      'finance_chart_analyst',
      'finance_portfolio',
    ]);
    expect(FINANCE_WORKERS.every((w) => w.domain === 'finance' && w.isBuiltIn)).toBe(true);
    expect(FINANCE_WORKERS.every((w) => w.permissionProfile === 'network')).toBe(true);
    expect(FINANCE_WORKERS[3]!.preferredBlockIds).toEqual(
      expect.arrayContaining(['portfolio_summary', 'risk_report']),
    );
  });

  it('coding workers include implementer with isolated workspace', () => {
    expect(CODING_WORKERS).toHaveLength(4);
    expect(CODING_WORKERS.map((w) => w.id)).toEqual([
      'coding_reviewer',
      'coding_test_writer',
      'coding_refactor',
      'coding_implementer',
    ]);
    const impl = CODING_WORKERS.find((w) => w.id === 'coding_implementer')!;
    expect(impl.permissionProfile).toBe('execute');
    expect(impl.workspace).toEqual({ kind: 'isolated' });
    expect(CODING_WORKERS.every((w) => w.workspace?.kind === 'isolated')).toBe(true);
  });

  it('research pack MVP has web + synthesizer', () => {
    expect(RESEARCH_WORKERS).toHaveLength(2);
    expect(RESEARCH_WORKERS.map((w) => w.id)).toEqual([
      'research_web',
      'research_synthesizer',
    ]);
    expect(RESEARCH_WORKERS[0]!.permissionProfile).toBe('network');
    expect(RESEARCH_WORKERS[1]!.permissionProfile).toBe('read_only');
  });

  it('general pack has generalist + coordinator', () => {
    expect(GENERAL_WORKERS.map((w) => w.id)).toEqual([
      'general_generalist',
      'general_coordinator',
    ]);
    expect(GENERAL_WORKERS[0]!.defaultMode).toBe('solo');
    expect(GENERAL_WORKERS[1]!.defaultMode).toBe('coordinator');
    expect(GENERAL_WORKERS[1]!.constraints?.maxSpawnedWorkers).toBe(4);
  });

  it('has unique worker ids across all packs', () => {
    const ids = listWorkers().map((w) => w.id);
    // May include custom registrations from other tests; uniqueness still required
    expect(new Set(ids).size).toBe(ids.length);
  });
});
