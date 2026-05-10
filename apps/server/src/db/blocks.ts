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
  const rows = domain
    ? db.prepare('SELECT * FROM custom_block WHERE domain = ? ORDER BY name').all(domain) as BlockRow[]
    : db.prepare('SELECT * FROM custom_block ORDER BY name').all() as BlockRow[];
  return rows.map(rowToBlock);
}

export function getCustomBlock(id: string): WorkflowBlock | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_block WHERE id = ?').get(id) as BlockRow | undefined;
  return row ? rowToBlock(row) : null;
}

export function createCustomBlock(block: Omit<WorkflowBlock, 'isBuiltIn'>): WorkflowBlock {
  const db = getDb();
  db.prepare(`
    INSERT INTO custom_block (
      id, name, domain, category, description, implementation_type,
      param_defs_json, input_description, output_description,
      prompt_template, skill_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    block.id,
    block.name,
    block.domain,
    block.category,
    block.description,
    block.implementationType,
    JSON.stringify(block.paramDefs),
    block.inputDescription,
    block.outputDescription,
    block.promptTemplate ?? null,
    block.skillId ?? null,
  );
  return { ...block, isBuiltIn: false };
}

export function updateCustomBlock(id: string, patch: Partial<Omit<WorkflowBlock, 'id' | 'isBuiltIn'>>): WorkflowBlock | null {
  const db = getDb();
  const existing = getCustomBlock(id);
  if (!existing) return null;

  const updated: Omit<WorkflowBlock, 'isBuiltIn'> = {
    ...existing,
    ...patch,
    id,
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
    id,
  );

  return { ...updated, isBuiltIn: false };
}

export function deleteCustomBlock(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_block WHERE id = ?').run(id);
  return result.changes > 0;
}
