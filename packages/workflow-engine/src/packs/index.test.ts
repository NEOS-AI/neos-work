import { describe, expect, it } from 'vitest';
import type { DomainWorker } from '@neos-work/shared';
import {
  BUILT_IN_PACK_IDS,
  isBuiltInPackId,
  listPacks,
  listWorkers,
  registerWorker,
  resolvePack,
  resolveWorker,
} from './index.js';
import { CODING_WORKERS, CODING_BLOCK_IDS } from './coding.js';
import { FINANCE_WORKERS, FINANCE_BLOCK_IDS } from './finance.js';
import { RESEARCH_WORKERS } from './research.js';
import { GENERAL_WORKERS } from './general.js';

describe('BUILT_IN_PACK_IDS / isBuiltInPackId', () => {
  it('lists the four built-in packs', () => {
    expect([...BUILT_IN_PACK_IDS].sort()).toEqual(['coding', 'finance', 'general', 'research']);
  });

  it('accepts known pack ids case-insensitively after trim', () => {
    expect(isBuiltInPackId('finance')).toBe(true);
    expect(isBuiltInPackId('  CODING  ')).toBe(true);
    expect(isBuiltInPackId('Research')).toBe(true);
    expect(isBuiltInPackId('general')).toBe(true);
  });

  it('rejects unknown, blank, and non-string ids', () => {
    expect(isBuiltInPackId('unknown-pack')).toBe(false);
    expect(isBuiltInPackId('')).toBe(false);
    expect(isBuiltInPackId('   ')).toBe(false);
    expect(isBuiltInPackId(null as unknown as string)).toBe(false);
    expect(isBuiltInPackId(undefined as unknown as string)).toBe(false);
    expect(isBuiltInPackId(1 as unknown as string)).toBe(false);
  });
});

describe('listPacks / resolvePack', () => {
  it('returns all built-in packs with workers and block ids', () => {
    const packs = listPacks();
    expect(packs.map((p) => p.id).sort()).toEqual(['coding', 'finance', 'general', 'research']);
    for (const p of packs) {
      expect(p.isBuiltIn).toBe(true);
      expect(p.name.length).toBeGreaterThan(0);
      expect(Array.isArray(p.workers)).toBe(true);
      expect(Array.isArray(p.blockIds)).toBe(true);
      // Live workers for the domain include built-ins
      expect(p.workers.every((w) => w.domain === p.id)).toBe(true);
    }
  });

  it('resolvePack returns detail for known ids and undefined for bad ids', () => {
    const coding = resolvePack('coding');
    expect(coding?.id).toBe('coding');
    expect(coding?.blockIds).toEqual(expect.arrayContaining([...CODING_BLOCK_IDS]));
    expect(coding?.workers.some((w) => w.id === 'coding_reviewer')).toBe(true);

    const finance = resolvePack('  FINANCE  ');
    expect(finance?.id).toBe('finance');
    expect(finance?.blockIds).toEqual(expect.arrayContaining([...FINANCE_BLOCK_IDS]));

    expect(resolvePack('nope')).toBeUndefined();
    expect(resolvePack('')).toBeUndefined();
    expect(resolvePack('   ')).toBeUndefined();
    expect(resolvePack('bad\nid')).toBeUndefined();
    expect(resolvePack(`coding${'\0'}`)).toBeUndefined();
    expect(resolvePack(null as unknown as string)).toBeUndefined();
  });

  it('includes custom registered workers in pack detail', () => {
    registerWorker({
      id: 'cov_pack_custom_coding',
      name: 'Custom Coding Worker',
      domain: 'coding',
      description: 'custom',
      systemPrompt: 'You are a custom coding worker.',
      allowedTools: ['read_file'],
    });
    const pack = resolvePack('coding');
    expect(pack?.workers.some((w) => w.id === 'cov_pack_custom_coding')).toBe(true);
    expect(listPacks().find((p) => p.id === 'coding')?.workers.some((w) => w.id === 'cov_pack_custom_coding')).toBe(
      true,
    );
  });
});

describe('listWorkers / resolveWorker (packs API)', () => {
  it('seeds built-in workers from all packs', () => {
    const all = listWorkers();
    const ids = all.map((w) => w.id);
    for (const w of [...CODING_WORKERS, ...FINANCE_WORKERS, ...RESEARCH_WORKERS, ...GENERAL_WORKERS]) {
      expect(ids).toContain(w.id);
      expect(resolveWorker(w.id)?.domain).toBe(w.domain);
      expect(resolveWorker(w.id)?.isBuiltIn).toBe(true);
    }
  });

  it('filters research and general domains', () => {
    const research = listWorkers('research');
    expect(research.length).toBeGreaterThanOrEqual(2);
    expect(research.every((w) => w.domain === 'research')).toBe(true);
    expect(research.map((w) => w.id)).toEqual(
      expect.arrayContaining(['research_web', 'research_synthesizer']),
    );

    const general = listWorkers('general');
    expect(general.map((w) => w.id)).toEqual(
      expect.arrayContaining(['general_generalist', 'general_coordinator']),
    );
  });
});

describe('registerWorker hygiene', () => {
  it('normalizes permissionProfile, workspace, defaultMode, preferredBlockIds', () => {
    registerWorker({
      id: '  cov_worker_norm  ',
      name: '  Norm Worker  ',
      domain: 'custom-domain' as never, // unknown → general
      description: 'd'.repeat(3_000),
      systemPrompt: `  ${'P'.repeat(120_000)}  `,
      allowedTools: ['  read_file  ', 'bad\ntool', '', 'x'.repeat(101), 'write_file'],
      permissionProfile: '  READ_ONLY  ' as never,
      workspace: { kind: 'run', subdir: `  workspace-sub  ${'\n'}` } as never,
      defaultMode: '  SOLO  ' as never,
      preferredBlockIds: ['  file_read  ', 'bad\nid', '', 'b'.repeat(101), 'git_diff'],
      isBuiltIn: false,
    });

    const w = resolveWorker('cov_worker_norm');
    expect(w).toBeDefined();
    expect(w!.name).toBe('Norm Worker');
    expect(w!.domain).toBe('general');
    expect(w!.description.length).toBe(2_000);
    expect(w!.systemPrompt.length).toBe(100_000);
    expect(w!.allowedTools).toEqual(['read_file', 'write_file']);
    expect(w!.permissionProfile).toBe('read_only');
    // control-char subdir rejected → plain run policy
    expect(w!.workspace).toEqual({ kind: 'run' });
    expect(w!.defaultMode).toBe('solo');
    expect(w!.preferredBlockIds).toEqual(['file_read', 'git_diff']);
    expect(w!.isBuiltIn).toBe(false);
  });

  it('accepts isolated/none workspace and rejects invalid permission/mode', () => {
    registerWorker({
      id: 'cov_worker_isolated',
      name: 'Iso',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'prompt',
      allowedTools: [],
      permissionProfile: 'not-a-profile' as never,
      workspace: { kind: 'isolated' },
      defaultMode: 'team' as never,
    });
    const iso = resolveWorker('cov_worker_isolated');
    expect(iso?.workspace).toEqual({ kind: 'isolated' });
    expect(iso?.permissionProfile).toBeUndefined();
    expect(iso?.defaultMode).toBeUndefined();

    registerWorker({
      id: 'cov_worker_none_ws',
      name: 'None',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'prompt',
      allowedTools: [],
      workspace: { kind: 'none' },
      defaultMode: 'coordinator',
      permissionProfile: 'full',
    });
    const none = resolveWorker('cov_worker_none_ws');
    expect(none?.workspace).toEqual({ kind: 'none' });
    expect(none?.defaultMode).toBe('coordinator');
    expect(none?.permissionProfile).toBe('full');
  });

  it('accepts run workspace with safe subdir and drops empty preferredBlockIds', () => {
    registerWorker({
      id: 'cov_worker_run_sub',
      name: 'RunSub',
      domain: 'research',
      description: 'd',
      systemPrompt: 'prompt',
      allowedTools: ['web_search'],
      workspace: { kind: 'run', subdir: '  outputs/run-1  ' },
      preferredBlockIds: ['\nbad', ''],
    } as DomainWorker);
    const w = resolveWorker('cov_worker_run_sub');
    expect(w?.workspace).toEqual({ kind: 'run', subdir: 'outputs/run-1' });
    expect(w?.preferredBlockIds).toBeUndefined();
  });

  it('rejects overlong ids and non-string systemPrompt', () => {
    registerWorker({
      id: 'x'.repeat(201),
      name: 'Long',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(resolveWorker('x'.repeat(201))).toBeUndefined();

    registerWorker({
      id: 'cov_worker_bad_prompt_type',
      name: 'Bad',
      domain: 'general',
      description: '',
      systemPrompt: 123 as unknown as string,
      allowedTools: [],
    });
    expect(resolveWorker('cov_worker_bad_prompt_type')).toBeUndefined();

    // Non-string id short-circuit
    registerWorker({
      id: 99 as unknown as string,
      name: 'Num',
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(resolveWorker('99')).toBeUndefined();
  });

  it('caps name length and falls back to id when name is control-char', () => {
    registerWorker({
      id: 'cov_worker_name_cap',
      name: 'N'.repeat(300),
      domain: 'general',
      description: '',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(resolveWorker('cov_worker_name_cap')?.name.length).toBe(200);

    registerWorker({
      id: 'cov_worker_name_ctrl',
      name: `bad${'\n'}name`,
      domain: 'general',
      description: undefined as unknown as string,
      systemPrompt: 'p',
      allowedTools: null as unknown as string[],
    });
    const w = resolveWorker('cov_worker_name_ctrl');
    expect(w?.name).toBe('cov_worker_name_ctrl');
    expect(w?.description).toBe('');
    expect(w?.allowedTools).toEqual([]);
  });
});

describe('built-in research and general catalogs', () => {
  it('research workers expose network/read_only profiles and output schemas', () => {
    const web = resolveWorker('research_web');
    expect(web?.permissionProfile).toBe('network');
    expect(web?.defaultMode).toBe('solo');
    expect(web?.outputSchema?.required).toEqual(
      expect.arrayContaining(['querySummary', 'findings', 'sources']),
    );

    const synth = resolveWorker('research_synthesizer');
    expect(synth?.permissionProfile).toBe('read_only');
    expect(synth?.allowedTools).toEqual(['read_file']);
  });

  it('general coordinator has coordinator mode and spawn caps', () => {
    const coord = resolveWorker('general_coordinator');
    expect(coord?.defaultMode).toBe('coordinator');
    expect(coord?.constraints?.maxSpawnedWorkers).toBe(4);
    expect(coord?.permissionProfile).toBe('read_only');

    const gen = resolveWorker('general_generalist');
    expect(gen?.defaultMode).toBe('solo');
    expect(gen?.permissionProfile).toBe('full');
  });
});
