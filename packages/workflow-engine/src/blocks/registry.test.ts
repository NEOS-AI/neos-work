import { describe, expect, it } from 'vitest';
import {
  getNativeExecutor,
  listBlocks,
  normalizeImplementationType,
  registerBlockMeta,
  registerNativeBlock,
  resolveBlock,
} from './registry.js';
import type { WorkflowBlock } from '@neos-work/shared';

describe('block registry', () => {
  it('normalizeImplementationType allow-list', () => {
    expect(normalizeImplementationType('native')).toBe('native');
    expect(normalizeImplementationType('  PROMPT  ')).toBe('prompt');
    expect(normalizeImplementationType('Skill')).toBe('skill');
    expect(normalizeImplementationType('wasm')).toBe('native');
    expect(normalizeImplementationType('')).toBe('native');
    expect(normalizeImplementationType(null)).toBe('native');
    // Leading control-char must not strip to a valid type
    expect(normalizeImplementationType('\nprompt')).toBe('native');
    expect(normalizeImplementationType('skill\n')).toBe('native');
  });

  it('registers and resolves native executor', async () => {
    registerNativeBlock({
      blockId: 'test_block_coverage',
      execute: async () => ({ ok: true, output: 42, durationMs: 1 }),
    });
    const ex = getNativeExecutor('test_block_coverage');
    expect(ex).toBeDefined();
    const result = await ex!.execute({ params: {}, inputs: {}, settings: {} });
    expect(result).toEqual({ ok: true, output: 42, durationMs: 1 });
  });

  it('stores optional metadata', () => {
    const meta: WorkflowBlock = {
      id: 'meta_block_cov',
      name: 'Meta Block',
      domain: 'general',
      category: 'test',
      description: 'for coverage',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    };
    registerNativeBlock(
      {
        blockId: 'meta_block_cov',
        execute: async () => ({ ok: true, output: null, durationMs: 0 }),
      },
      meta,
    );
    expect(resolveBlock('meta_block_cov')?.name).toBe('Meta Block');
    expect(listBlocks('general').some((b) => b.id === 'meta_block_cov')).toBe(true);
    expect(listBlocks('coding').some((b) => b.id === 'meta_block_cov')).toBe(false);
  });

  it('returns undefined for unknown block', () => {
    expect(getNativeExecutor('nope-unknown')).toBeUndefined();
    expect(resolveBlock('nope-unknown')).toBeUndefined();
  });

  it('registerBlockMeta and id/domain trim hygiene', () => {
    const meta: WorkflowBlock = {
      id: '  prompt_meta_only  ',
      name: '  Prompt Only  ',
      domain: '  GENERAL  ' as never,
      category: '  test  ',
      description: '  meta without native executor  ',
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
      promptTemplate: '  Hello  ',
    };
    registerBlockMeta(meta);

    const got = resolveBlock('  prompt_meta_only  ');
    expect(got?.id).toBe('prompt_meta_only');
    expect(got?.name).toBe('Prompt Only');
    expect(got?.domain).toBe('general');
    expect(got?.category).toBe('test');
    expect(got?.description).toBe('meta without native executor');
    expect(got?.promptTemplate).toBe('Hello');
    expect(resolveBlock('   ')).toBeUndefined();
    expect(getNativeExecutor('  test_block_coverage  ')).toBeDefined();
    expect(getNativeExecutor('   ')).toBeUndefined();

    // domain filter trims + lower-cases; blank domain → all blocks
    expect(listBlocks('  GENERAL  ').some((b) => b.id === 'prompt_meta_only')).toBe(true);
    const all = listBlocks('   ');
    expect(all.some((b) => b.id === 'prompt_meta_only')).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(listBlocks('general').length);
  });

  it('trims ids when registering native/meta blocks; ignores blank ids', async () => {
    registerNativeBlock({
      blockId: '  reg_trim_native  ',
      execute: async () => ({ ok: true, output: 'n', durationMs: 0 }),
    });
    expect(getNativeExecutor('reg_trim_native')).toBeDefined();
    const r = await getNativeExecutor('  reg_trim_native  ')!.execute({
      params: {},
      inputs: {},
      settings: {},
    });
    expect(r.output).toBe('n');

    registerBlockMeta({
      id: '  reg_trim_meta  ',
      name: 'Trim Meta',
      domain: 'general',
      category: 'test',
      description: 'trim',
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
      promptTemplate: 'x',
    });
    expect(resolveBlock('reg_trim_meta')?.id).toBe('reg_trim_meta');

    registerNativeBlock({
      blockId: '   ',
      execute: async () => ({ ok: true, output: 1, durationMs: 0 }),
    });
    registerBlockMeta({
      id: '  ',
      name: 'x',
      domain: 'general',
      category: 't',
      description: '',
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    expect(getNativeExecutor('')).toBeUndefined();
    expect(resolveBlock('')).toBeUndefined();
  });

  it('drops non-string skillId values at registration', () => {
    registerBlockMeta({
      id: 'cov_skill_non_string',
      name: 'NonString Skill',
      domain: 'general',
      category: 'test',
      description: 'd',
      isBuiltIn: true,
      implementationType: 'skill',
      skillId: 12345 as never,
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    expect(resolveBlock('cov_skill_non_string')?.skillId).toBeUndefined();
  });

  it('maps invalid domains to general and preserves non-string descriptions', () => {
    registerBlockMeta({
      id: 'cov_domain_quantum',
      name: 'Quantum',
      domain: 'quantum' as never,
      category: 'test',
      description: 42 as never,
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    const got = resolveBlock('cov_domain_quantum');
    expect(got?.domain).toBe('general');
    expect(got?.description).toBe(42 as never);
  });

  it('rejects unsafe block ids and caps metadata fields', () => {
    registerNativeBlock({
      blockId: 'bad id!',
      execute: async () => ({ ok: true, output: 1, durationMs: 0 }),
    });
    expect(getNativeExecutor('bad id!')).toBeUndefined();

    registerBlockMeta({
      id: 'meta_cap_cov',
      name: `N${'\n'}ame`,
      domain: 'general',
      category: 'c'.repeat(200),
      description: 'd'.repeat(5_000),
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
      skillId: 'sk\nid',
      promptTemplate: 'p'.repeat(60_000),
    });
    const got = resolveBlock('meta_cap_cov');
    expect(got?.name).toBe('meta_cap_cov'); // control-char name → id
    expect(got?.category).toBe('custom');
    expect(got?.description!.length).toBe(2_000);
    expect(got?.skillId).toBeUndefined();
    expect(got?.promptTemplate!.length).toBe(50_000);

    // Leading control-char skillId must not strip to a valid id
    registerBlockMeta({
      id: 'meta_skill_lead',
      name: 'Lead Skill',
      domain: 'general',
      category: 'test',
      description: 'd',
      isBuiltIn: true,
      implementationType: 'skill',
      skillId: '\nvalid-skill',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    expect(resolveBlock('meta_skill_lead')?.skillId).toBeUndefined();

    // Leading control-char block id must not register or resolve
    registerBlockMeta({
      id: '\nvalid_id',
      name: 'Lead Id',
      domain: 'general',
      category: 'test',
      description: 'd',
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    expect(resolveBlock('\nvalid_id')).toBeUndefined();
    expect(resolveBlock('valid_id')).toBeUndefined();
    expect(getNativeExecutor('\ncode_eval')).toBeUndefined();
    expect(listBlocks('\nfinance')).toEqual(listBlocks()); // filter ignored

    // Leading control-char domain → general; control category → custom
    registerBlockMeta({
      id: 'meta_ctrl_domain',
      name: 'Ctrl Domain',
      domain: '\ncoding' as never,
      category: '\ncat',
      description: 'd',
      isBuiltIn: true,
      implementationType: '\nprompt' as never,
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    const ctrlDom = resolveBlock('meta_ctrl_domain');
    expect(ctrlDom?.domain).toBe('general');
    expect(ctrlDom?.category).toBe('custom');
    expect(ctrlDom?.implementationType).toBe('native');
  });
});
