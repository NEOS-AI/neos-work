/**
 * Custom block CRUD operations.
 */

import { getDb } from './schema.js';
import type { WorkflowBlock, BlockParamDef } from '@neos-work/shared';

interface BlockRow {
  id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  implementation_type: string;
  param_defs_json: string;
  input_description: string;
  output_description: string;
  prompt_template: string | null;
  skill_id: string | null;
  created_at: string;
  updated_at: string;
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

function normalizeDomain(raw: unknown): WorkflowBlock['domain'] {
  const domainRaw =
    typeof raw === 'string' ? raw.trim().toLowerCase() || 'general' : 'general';
  return (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as WorkflowBlock['domain'])
    : 'general';
}

function safeParseParamDefs(raw: string): BlockParamDef[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BlockParamDef[]) : [];
  } catch {
    return [];
  }
}

function rowToBlock(row: BlockRow): WorkflowBlock {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain as WorkflowBlock['domain'],
    category: row.category,
    description: row.description,
    isBuiltIn: false,
    implementationType: normalizeImplementationType(row.implementation_type),
    paramDefs: safeParseParamDefs(row.param_defs_json),
    inputDescription: row.input_description,
    outputDescription: row.output_description,
    promptTemplate: row.prompt_template ?? undefined,
    skillId: row.skill_id ?? undefined,
  };
}

export function listCustomBlocks(domain?: string): WorkflowBlock[] {
  const db = getDb();
  // Normalize domain filter so " CODING " matches stored lower-case domain
  const domainFilter =
    typeof domain === 'string' && domain.trim()
      ? normalizeDomain(domain)
      : undefined;
  const rows = domainFilter
    ? db.prepare('SELECT * FROM custom_block WHERE domain = ? ORDER BY name').all(domainFilter) as BlockRow[]
    : db.prepare('SELECT * FROM custom_block ORDER BY name').all() as BlockRow[];
  return rows.map(rowToBlock);
}

export function getCustomBlock(id: string): WorkflowBlock | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_block WHERE id = ?').get(trimmed) as BlockRow | undefined;
  return row ? rowToBlock(row) : null;
}

/** Cap prompt-template blocks (plan Task 12). */
export const BLOCK_PROMPT_TEMPLATE_MAX_CHARS = 50_000;
export const BLOCK_DESCRIPTION_MAX_CHARS = 2_000;

export function createCustomBlock(block: Omit<WorkflowBlock, 'isBuiltIn'>): WorkflowBlock {
  const id = typeof block.id === 'string' ? block.id.trim() : '';
  const name = typeof block.name === 'string' ? block.name.trim() : '';
  if (!id || !name) {
    throw new Error('id and name are required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('id must be alphanumeric (- and _ allowed)');
  }
  if (name.length > 200) {
    throw new Error('name exceeds max length (200)');
  }
  const domain = normalizeDomain(block.domain);
  const category =
    (typeof block.category === 'string' ? block.category.trim() : '') || 'custom';
  let description =
    typeof block.description === 'string' ? block.description.trim() : (block.description ?? '');
  if (typeof description === 'string' && description.length > BLOCK_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, BLOCK_DESCRIPTION_MAX_CHARS);
  }
  let promptTemplate =
    typeof block.promptTemplate === 'string' ? block.promptTemplate.trim() || undefined : block.promptTemplate;
  if (typeof promptTemplate === 'string' && promptTemplate.length > BLOCK_PROMPT_TEMPLATE_MAX_CHARS) {
    throw new Error(
      `promptTemplate exceeds max size (${BLOCK_PROMPT_TEMPLATE_MAX_CHARS} characters)`,
    );
  }
  const skillId =
    typeof block.skillId === 'string' ? block.skillId.trim() || undefined : block.skillId;
  const inputDescription =
    typeof block.inputDescription === 'string'
      ? block.inputDescription.trim()
      : (block.inputDescription ?? '');
  const outputDescription =
    typeof block.outputDescription === 'string'
      ? block.outputDescription.trim()
      : (block.outputDescription ?? '');
  const implementationType = normalizeImplementationType(block.implementationType);
  const paramDefs = Array.isArray(block.paramDefs) ? block.paramDefs : [];

  const db = getDb();
  db.prepare(`
    INSERT INTO custom_block (
      id, name, domain, category, description, implementation_type,
      param_defs_json, input_description, output_description,
      prompt_template, skill_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    domain,
    category,
    description,
    implementationType,
    JSON.stringify(paramDefs),
    inputDescription,
    outputDescription,
    promptTemplate ?? null,
    skillId ?? null,
  );
  return {
    ...block,
    id,
    name,
    domain,
    category,
    description,
    implementationType,
    promptTemplate,
    skillId,
    inputDescription,
    outputDescription,
    paramDefs,
    isBuiltIn: false,
  };
}

export function updateCustomBlock(id: string, patch: Partial<Omit<WorkflowBlock, 'id' | 'isBuiltIn'>>): WorkflowBlock | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  const db = getDb();
  const existing = getCustomBlock(trimmed);
  if (!existing) return null;

  const updated: Omit<WorkflowBlock, 'isBuiltIn'> = {
    ...existing,
    ...patch,
    id: trimmed,
  };

  // Normalize string fields the same way as create (defense-in-depth for direct DB callers)
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name || name.length > 200) return null;
    updated.name = name;
  }
  if (patch.domain !== undefined) {
    updated.domain = normalizeDomain(patch.domain);
  }
  if (typeof patch.category === 'string') {
    updated.category = patch.category.trim() || 'custom';
  }
  if (typeof patch.description === 'string') {
    const d = patch.description.trim();
    updated.description =
      d.length > BLOCK_DESCRIPTION_MAX_CHARS
        ? d.slice(0, BLOCK_DESCRIPTION_MAX_CHARS)
        : d;
  }
  if (typeof patch.promptTemplate === 'string') {
    const pt = patch.promptTemplate.trim() || undefined;
    if (pt && pt.length > BLOCK_PROMPT_TEMPLATE_MAX_CHARS) return null;
    updated.promptTemplate = pt;
  }
  if (typeof patch.skillId === 'string') {
    updated.skillId = patch.skillId.trim() || undefined;
  }
  if (typeof patch.inputDescription === 'string') {
    updated.inputDescription = patch.inputDescription.trim();
  }
  if (typeof patch.outputDescription === 'string') {
    updated.outputDescription = patch.outputDescription.trim();
  }
  if (patch.implementationType !== undefined) {
    updated.implementationType = normalizeImplementationType(patch.implementationType);
  }
  if (patch.paramDefs !== undefined) {
    updated.paramDefs = Array.isArray(patch.paramDefs) ? patch.paramDefs : existing.paramDefs;
  }

  db.prepare(`
    UPDATE custom_block SET
      name = ?, domain = ?, category = ?, description = ?, implementation_type = ?,
      param_defs_json = ?, input_description = ?, output_description = ?,
      prompt_template = ?, skill_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updated.name,
    updated.domain,
    updated.category,
    updated.description,
    normalizeImplementationType(updated.implementationType),
    JSON.stringify(Array.isArray(updated.paramDefs) ? updated.paramDefs : []),
    updated.inputDescription,
    updated.outputDescription,
    updated.promptTemplate ?? null,
    updated.skillId ?? null,
    trimmed,
  );

  return {
    ...updated,
    implementationType: normalizeImplementationType(updated.implementationType),
    paramDefs: Array.isArray(updated.paramDefs) ? updated.paramDefs : [],
    isBuiltIn: false,
  };
}

export function deleteCustomBlock(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_block WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
