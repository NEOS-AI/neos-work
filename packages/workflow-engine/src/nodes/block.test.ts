import { describe, expect, it } from 'vitest';
import { BlockNode } from './block.js';
import { registerBlockMeta, registerNativeBlock, resolveBlock } from '../blocks/registry.js';
import type { NodeContext } from '../types.js';
import type { WorkflowBlock } from '@neos-work/shared';

function ctx(config: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'block',
    inputs,
    settings: {},
    config,
  };
}

describe('BlockNode', () => {
  const node = new BlockNode();

  it('requires blockId', async () => {
    const result = await node.execute(ctx({}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/blockId is required/);
  });

  it('treats whitespace-only blockId as missing', async () => {
    const result = await node.execute(ctx({ blockId: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/blockId is required/);
  });

  it('trims blockId before resolve', async () => {
    const meta: WorkflowBlock = {
      id: 'cov_trim_block',
      name: 'Trim Block',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    };
    registerNativeBlock(
      {
        blockId: 'cov_trim_block',
        execute: async () => ({ ok: true, output: 'trimmed', durationMs: 0 }),
      },
      meta,
    );
    const result = await node.execute(ctx({ blockId: '  cov_trim_block  ' }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('trimmed');
  });

  it('fails when block metadata is missing', async () => {
    const result = await node.execute(ctx({ blockId: 'does-not-exist-xyz' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Block not found/);
  });

  it('rejects prompt blocks without promptTemplate and skill blocks without skillId', async () => {
    registerBlockMeta({
      id: 'cov_prompt_empty',
      name: 'Empty Prompt',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
      promptTemplate: '   ',
    });
    const promptRes = await node.execute(ctx({ blockId: 'cov_prompt_empty' }));
    expect(promptRes.ok).toBe(false);
    expect(promptRes.error).toMatch(/promptTemplate/i);

    registerBlockMeta({
      id: 'cov_skill_empty',
      name: 'Empty Skill',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'skill',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
      skillId: '  ',
    });
    const skillRes = await node.execute(ctx({ blockId: 'cov_skill_empty' }));
    expect(skillRes.ok).toBe(false);
    expect(skillRes.error).toMatch(/skillId/i);
  });

  it('runs native executor when registered with metadata', async () => {
    const meta: WorkflowBlock = {
      id: 'cov_native_block',
      name: 'Cov Native',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    };
    registerNativeBlock(
      {
        blockId: 'cov_native_block',
        execute: async ({ params }) => ({
          ok: true,
          output: { echoed: params['x'] ?? null },
          durationMs: 1,
        }),
      },
      meta,
    );
    expect(resolveBlock('cov_native_block')?.id).toBe('cov_native_block');

    const result = await node.execute(ctx({ blockId: 'cov_native_block', params: { x: 42 } }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echoed: 42 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const trimmedParams = await node.execute(
      ctx({
        blockId: 'cov_native_block',
        params: { '  x  ': '  value  ', '  ': 'skip', y: 1 },
      }),
    );
    expect(trimmedParams.ok).toBe(true);
    expect(trimmedParams.output).toEqual({ echoed: 'value' });
  });

  it('fails when native meta exists but executor missing', async () => {
    // Meta-only registration: no getNativeExecutor entry
    registerBlockMeta({
      id: 'cov_meta_only_native',
      name: 'Meta Only Native',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    const result = await node.execute(ctx({ blockId: 'cov_meta_only_native' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Native executor not found/i);
  });

  it('falls back unknown implementationType to native at registration', async () => {
    // registry.normalizeImplementationType: unknown → native
    registerBlockMeta({
      id: 'cov_unknown_impl',
      name: 'Unknown Impl',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'wasm' as never,
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    const result = await node.execute(ctx({ blockId: 'cov_unknown_impl' }));
    expect(result.ok).toBe(false);
    // Meta-only native path (no executor registered)
    expect(result.error).toMatch(/Native executor not found/i);
  });

  it('treats case-insensitive implementationType as native', async () => {
    registerNativeBlock(
      {
        blockId: 'cov_native_case',
        execute: async () => ({ ok: true, output: 'cased', durationMs: 0 }),
      },
      {
        id: 'cov_native_case',
        name: 'Cased Native',
        domain: 'general',
        category: 'test',
        description: 'test',
        isBuiltIn: true,
        implementationType: 'NATIVE' as never,
        paramDefs: [],
        inputDescription: '',
        outputDescription: '',
      },
    );
    const result = await node.execute(ctx({ blockId: 'cov_native_case' }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('cased');
  });

  it('coerces non-string blockId via String()', async () => {
    const meta: WorkflowBlock = {
      id: '12345',
      name: 'Numeric Id',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    };
    registerNativeBlock(
      {
        blockId: '12345',
        execute: async () => ({ ok: true, output: 'num', durationMs: 0 }),
      },
      meta,
    );
    const result = await node.execute(ctx({ blockId: 12345 as never }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('num');
  });
});
