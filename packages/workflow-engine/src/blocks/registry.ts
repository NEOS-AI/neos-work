/**
 * Block registry — manages built-in and dynamically registered domain blocks.
 */

import type { WorkflowBlock } from '@neos-work/shared';
import type { NativeBlockExecutor } from './types.js';

const builtInRegistry = new Map<string, NativeBlockExecutor>();
const metaRegistry = new Map<string, WorkflowBlock>();

/**
 * Register a native block executor. Optionally pass metadata for the block.
 * Called with a single executor object (blockId + execute) or with both meta + executor.
 */
export function registerNativeBlock(executor: NativeBlockExecutor, meta?: WorkflowBlock): void {
  builtInRegistry.set(executor.blockId, executor);
  if (meta) metaRegistry.set(meta.id, meta);
}

export function resolveBlock(id: string): WorkflowBlock | undefined {
  return metaRegistry.get(id);
}

export function getNativeExecutor(id: string): NativeBlockExecutor | undefined {
  return builtInRegistry.get(id);
}

export function listBlocks(domain?: string): WorkflowBlock[] {
  const all = [...metaRegistry.values()];
  return domain ? all.filter((b) => b.domain === domain) : all;
}
