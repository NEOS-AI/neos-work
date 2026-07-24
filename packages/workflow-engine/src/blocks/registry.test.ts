import { describe, expect, it } from 'vitest';
import {
  getNativeExecutor,
  listBlocks,
  registerBlockMeta,
  registerNativeBlock,
  resolveBlock,
} from './registry.js';
import type { WorkflowBlock } from '@neos-work/shared';

describe('block registry', () => {
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
});
