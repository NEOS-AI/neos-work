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
  // Control-char domain → general (check before trim)
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'general';
  const d = raw.trim().toLowerCase() || 'general';
  // Built-in domains + custom pack slugs (Domain Pack SDK)
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(d)) return d;
  return 'general';
}

const IMPLEMENTATION_TYPES = new Set(['native', 'prompt', 'skill']);

/** Normalize implementationType (unknown → native). */
export function normalizeImplementationType(
  raw: unknown,
): WorkflowBlock['implementationType'] {
  // Control-char check before trim so "\nprompt" is not accepted as prompt
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'native';
  const t = raw.trim().toLowerCase();
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
  // Control-char name → id fallback (check before trim)
  let name = id;
  if (typeof meta.name === 'string' && !/[\0\r\n]/.test(meta.name)) {
    name = meta.name.trim() || id;
  }
  if (name.length > BLOCK_NAME_MAX) name = name.slice(0, BLOCK_NAME_MAX);

  let category: string = 'custom';
  if (typeof meta.category === 'string' && !/[\0\r\n]/.test(meta.category)) {
    category = meta.category.trim() || 'custom';
  }
  if (category.length > BLOCK_CATEGORY_MAX) category = 'custom';

  let description: string | undefined;
  if (typeof meta.description === 'string') {
    // Null-byte reject; multi-line descriptions allowed
    if (!/\0/.test(meta.description)) {
      description = meta.description.trim();
    }
  } else {
    // Legacy pass-through (tests cast non-strings into WorkflowBlock.description)
    description = meta.description;
  }
  if (typeof description === 'string' && description.length > BLOCK_DESC_MAX) {
    description = description.slice(0, BLOCK_DESC_MAX);
  }

  let promptTemplate: string | undefined;
  if (typeof meta.promptTemplate === 'string') {
    // Null-byte reject (newlines OK in templates)
    if (!/\0/.test(meta.promptTemplate)) {
      promptTemplate = meta.promptTemplate.trim() || undefined;
    }
  } else {
    promptTemplate = meta.promptTemplate;
  }
  if (typeof promptTemplate === 'string' && promptTemplate.length > BLOCK_PROMPT_MAX) {
    promptTemplate = promptTemplate.slice(0, BLOCK_PROMPT_MAX);
  }

  // Control-char before trim so leading \n cannot strip to a valid skill id
  let skillId: string | undefined;
  if (typeof meta.skillId === 'string') {
    if (/[\0\r\n]/.test(meta.skillId) || meta.skillId.trim().length > BLOCK_SKILL_ID_MAX) {
      skillId = undefined;
    } else {
      skillId = meta.skillId.trim() || undefined;
    }
  } else if (meta.skillId != null) {
    skillId = undefined;
  }

  return {
    ...meta,
    id,
    name,
    domain: normalizeDomain(meta.domain),
    category,
    // Null-byte strings become undefined → surface as empty string for type safety
    description: (description ?? '') as string,
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
  if (typeof executor.blockId !== 'string' || /[\0\r\n]/.test(executor.blockId)) return;
  const blockId = executor.blockId.trim();
  if (!isSafeBlockId(blockId)) return;
  builtInRegistry.set(blockId, { ...executor, blockId });
  if (meta) {
    if (typeof meta.id !== 'string' || /[\0\r\n]/.test(meta.id)) return;
    const metaId = meta.id.trim();
    if (isSafeBlockId(metaId)) metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
  }
}

/** Register block metadata without a native executor (prompt/skill blocks, tests). */
export function registerBlockMeta(meta: WorkflowBlock): void {
  if (typeof meta.id !== 'string' || /[\0\r\n]/.test(meta.id)) return;
  const metaId = meta.id.trim();
  if (!isSafeBlockId(metaId)) return;
  metaRegistry.set(metaId, normalizeBlockMeta(meta, metaId));
}

export function resolveBlock(id: string): WorkflowBlock | undefined {
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim();
  if (!isSafeBlockId(trimmed)) return undefined;
  return metaRegistry.get(trimmed);
}

export function getNativeExecutor(id: string): NativeBlockExecutor | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim();
  if (!isSafeBlockId(trimmed)) return undefined;
  return builtInRegistry.get(trimmed);
}

export function listBlocks(domain?: string): WorkflowBlock[] {
  const domainRaw =
    typeof domain === 'string' && !/[\0\r\n]/.test(domain)
      ? domain.trim().toLowerCase() || undefined
      : undefined;
  const all = [...metaRegistry.values()];
  if (!domainRaw) return all;
  return all.filter((b) => b.domain === domainRaw);
}

/**
 * Remove block metadata from the registry (custom pack uninstall / disable).
 * Built-in blocks may also be removed in-process for tests; prefer only custom ids.
 * Returns true when an entry was deleted.
 */
export function unregisterBlockMeta(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim();
  if (!isSafeBlockId(trimmed)) return false;
  return metaRegistry.delete(trimmed);
}
