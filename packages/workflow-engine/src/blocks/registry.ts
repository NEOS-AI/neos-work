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
function normalizeDomain(raw: unknown): WorkflowBlock['domain'] {
  const d = typeof raw === 'string' ? raw.trim().toLowerCase() || 'general' : 'general';
  return (['finance', 'coding', 'general'] as const).includes(d as never)
    ? (d as WorkflowBlock['domain'])
    : 'general';
}

const IMPLEMENTATION_TYPES = new Set(['native', 'prompt', 'skill']);

/** Normalize implementationType (unknown → native). */
export function normalizeImplementationType(
  raw: unknown,
): WorkflowBlock['implementationType'] {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return IMPLEMENTATION_TYPES.has(t)
    ? (t as WorkflowBlock['implementationType'])
    : 'native';
}

function normalizeBlockMeta(meta: WorkflowBlock, id: string): WorkflowBlock {
  return {
    ...meta,
    id,
    name: typeof meta.name === 'string' ? meta.name.trim() || id : id,
    domain: normalizeDomain(meta.domain),
    category: typeof meta.category === 'string' ? meta.category.trim() || 'custom' : (meta.category ?? 'custom'),
    description: typeof meta.description === 'string' ? meta.description.trim() : meta.description,
    implementationType: normalizeImplementationType(meta.implementationType),
    promptTemplate:
      typeof meta.promptTemplate === 'string'
        ? meta.promptTemplate.trim() || undefined
        : meta.promptTemplate,
    skillId:
      typeof meta.skillId === 'string' ? meta.skillId.trim() || undefined : meta.skillId,
  };
}

export function registerNativeBlock(executor: NativeBlockExecutor, meta?: WorkflowBlock): void {
  const blockId = typeof executor.blockId === 'string' ? executor.blockId.trim() : '';
  if (!blockId) return;
  builtInRegistry.set(blockId, { ...executor, blockId });
  if (meta) {
    const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
    if (metaId) metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
  }
}

/** Register block metadata without a native executor (prompt/skill blocks, tests). */
export function registerBlockMeta(meta: WorkflowBlock): void {
  const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (!metaId) return;
  metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
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
  const domainRaw = typeof domain === 'string' ? domain.trim().toLowerCase() || undefined : undefined;
  const all = [...metaRegistry.values()];
  if (!domainRaw) return all;
  return all.filter((b) => b.domain === domainRaw);
}
