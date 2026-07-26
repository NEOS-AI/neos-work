import { describe, expect, it, vi } from 'vitest';

vi.mock('../blocks/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../blocks/registry.js')>();
  return {
    ...actual,
    // Force the fail-closed unknown-implementation branch after normalize
    normalizeImplementationType: () => 'wasm' as never,
  };
});

const { BlockNode } = await import('./block.js');
const { registerBlockMeta } = await import('../blocks/registry.js');
import type { NodeContext } from '../types.js';

function ctx(config: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'block',
    inputs: {},
    settings: {},
    config,
  };
}

describe('BlockNode unknown implementationType', () => {
  it('fails closed when normalize returns an unknown implementation type', async () => {
    registerBlockMeta({
      id: 'cov_unknown_impl_branch',
      name: 'Unknown Branch',
      domain: 'general',
      category: 'test',
      description: 'test',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    const node = new BlockNode();
    const result = await node.execute(ctx({ blockId: 'cov_unknown_impl_branch' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown implementationType/i);
  });
});
