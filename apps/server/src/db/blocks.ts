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

function rowToBlock(row: BlockRow): WorkflowBlock {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain as WorkflowBlock['domain'],
    category: row.category,
    description: row.description,
    isBuiltIn: false,
    implementationType: row.implementation_type as WorkflowBlock['implementationType'],
    paramDefs: JSON.parse(row.param_defs_json) as BlockParamDef[],
    inputDescription: row.input_description,
    outputDescription: row.output_description,
    promptTemplate: row.prompt_template ?? undefined,
    skillId: row.skill_id ?? undefined,
  };
}

export function listCustomBlocks(domain?: string): WorkflowBlock[] {
  const db = getDb();
  const domainFilter = typeof domain === 'string' ? domain.trim() || undefined : undefined;
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

export function createCustomBlock(block: Omit<WorkflowBlock, 'isBuiltIn'>): WorkflowBlock {
  const id = typeof block.id === 'string' ? block.id.trim() : '';
  const name = typeof block.name === 'string' ? block.name.trim() : '';
  if (!id || !name) {
    throw new Error('id and name are required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('id must be alphanumeric (- and _ allowed)');
  }
  const domainRaw =
    typeof block.domain === 'string' ? block.domain.trim().toLowerCase() || 'general' : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as WorkflowBlock['domain'])
    : 'general';
  const category =
    (typeof block.category === 'string' ? block.category.trim() : '') || 'custom';
  const description =
    typeof block.description === 'string' ? block.description.trim() : (block.description ?? '');
  const promptTemplate =
    typeof block.promptTemplate === 'string' ? block.promptTemplate.trim() || undefined : block.promptTemplate;
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
    block.implementationType,
    JSON.stringify(block.paramDefs ?? []),
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
    promptTemplate,
    skillId,
    inputDescription,
    outputDescription,
    paramDefs: block.paramDefs ?? [],
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
    updated.implementationType,
    JSON.stringify(updated.paramDefs),
    updated.inputDescription,
    updated.outputDescription,
    updated.promptTemplate ?? null,
    updated.skillId ?? null,
    trimmed,
  );

  return { ...updated, isBuiltIn: false };
}

export function deleteCustomBlock(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_block WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
