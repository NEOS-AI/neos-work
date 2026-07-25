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

/** Cap registry metadata fields (list/UI hygiene). */
const BLOCK_NAME_MAX = 200;
const BLOCK_DESC_MAX = 2_000;
const BLOCK_PROMPT_MAX = 50_000;
const BLOCK_CATEGORY_MAX = 100;
const BLOCK_SKILL_ID_MAX = 200;

function normalizeBlockMeta(meta: WorkflowBlock, id: string): WorkflowBlock {
  let name = typeof meta.name === 'string' ? meta.name.trim() || id : id;
  if (/[\0\r\n]/.test(name)) name = id;
  if (name.length > BLOCK_NAME_MAX) name = name.slice(0, BLOCK_NAME_MAX);

  let category =
    typeof meta.category === 'string' ? meta.category.trim() || 'custom' : (meta.category ?? 'custom');
  if (typeof category === 'string') {
    if (/[\0\r\n]/.test(category) || category.length > BLOCK_CATEGORY_MAX) category = 'custom';
  }

  let description =
    typeof meta.description === 'string' ? meta.description.trim() : meta.description;
  if (typeof description === 'string' && description.length > BLOCK_DESC_MAX) {
    description = description.slice(0, BLOCK_DESC_MAX);
  }

  let promptTemplate =
    typeof meta.promptTemplate === 'string'
      ? meta.promptTemplate.trim() || undefined
      : meta.promptTemplate;
  if (typeof promptTemplate === 'string' && promptTemplate.length > BLOCK_PROMPT_MAX) {
    promptTemplate = promptTemplate.slice(0, BLOCK_PROMPT_MAX);
  }

  let skillId =
    typeof meta.skillId === 'string' ? meta.skillId.trim() || undefined : meta.skillId;
  if (
    typeof skillId === 'string'
    && (skillId.length > BLOCK_SKILL_ID_MAX || /[\0\r\n]/.test(skillId))
  ) {
    skillId = undefined;
  }

  return {
    ...meta,
    id,
    name,
    domain: normalizeDomain(meta.domain),
    category,
    description,
    implementationType: normalizeImplementationType(meta.implementationType),
    promptTemplate,
    skillId,
  };
}

function isSafeBlockId(id: string): boolean {
  // Prefer alphanumeric/_- ids (align with blocks route create validation)
  return (
    id.length > 0
    && id.length <= 200
    && !/[\0\r\n]/.test(id)
    && /^[a-zA-Z0-9_-]+$/.test(id)
  );
}

export function registerNativeBlock(executor: NativeBlockExecutor, meta?: WorkflowBlock): void {
  const blockId = typeof executor.blockId === 'string' ? executor.blockId.trim() : '';
  if (!isSafeBlockId(blockId)) return;
  builtInRegistry.set(blockId, { ...executor, blockId });
  if (meta) {
    const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
    if (isSafeBlockId(metaId)) metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
  }
}

/** Register block metadata without a native executor (prompt/skill blocks, tests). */
export function registerBlockMeta(meta: WorkflowBlock): void {
  const metaId = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (!isSafeBlockId(metaId)) return;
  metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
}

export function resolveBlock(id: string): WorkflowBlock | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!isSafeBlockId(trimmed)) return undefined;
  return metaRegistry.get(trimmed);
}

export function getNativeExecutor(id: string): NativeBlockExecutor | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!isSafeBlockId(trimmed)) return undefined;
  return builtInRegistry.get(trimmed);
}

export function listBlocks(domain?: string): WorkflowBlock[] {
  const domainRaw = typeof domain === 'string' ? domain.trim().toLowerCase() || undefined : undefined;
  const all = [...metaRegistry.values()];
  if (!domainRaw) return all;
  return all.filter((b) => b.domain === domainRaw);
}
