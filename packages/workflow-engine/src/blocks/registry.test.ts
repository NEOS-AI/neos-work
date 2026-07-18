import { describe, expect, it } from 'vitest';
import {
  getNativeExecutor,
  listBlocks,
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
});
