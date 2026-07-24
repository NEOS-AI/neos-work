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
  const blockId = typeof executor.blockId === 'string' ? executor.blockId.trim() : '';
  if (!blockId) return;
  builtInRegistry.set(blockId, { ...executor, blockId });
  if (meta) {
    const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
    if (metaId) metaRegistry.set(metaId, { ...meta, id: metaId });
  }
}

/** Register block metadata without a native executor (prompt/skill blocks, tests). */
export function registerBlockMeta(meta: WorkflowBlock): void {
  const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (!metaId) return;
  metaRegistry.set(metaId, { ...meta, id: metaId });
}

export function resolveBlock(id: string): WorkflowBlock | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  return metaRegistry.get(trimmed);
}

export function getNativeExecutor(id: string): NativeBlockExecutor | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  return builtInRegistry.get(trimmed);
}

export function listBlocks(domain?: string): WorkflowBlock[] {
  const domainFilter = typeof domain === 'string' ? domain.trim() || undefined : undefined;
  const all = [...metaRegistry.values()];
  return domainFilter ? all.filter((b) => b.domain === domainFilter) : all;
}
