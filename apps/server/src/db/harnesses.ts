/**
 * Custom harness CRUD operations (SQLite).
 */

import { getDb } from './schema.js';
import type { AgentHarness } from '@neos-work/shared';

interface HarnessRow {
  id: string;
  name: string;
  domain: string;
  description: string;
  system_prompt: string;
  allowed_tools_json: string;
  constraints_json: string;
  created_at: string;
  updated_at: string;
}

function rowToHarness(row: HarnessRow): AgentHarness {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain as AgentHarness['domain'],
    description: row.description,
    systemPrompt: row.system_prompt,
    allowedTools: JSON.parse(row.allowed_tools_json) as string[],
    constraints: JSON.parse(row.constraints_json) as AgentHarness['constraints'],
    isBuiltIn: false,
  };
}

export function listCustomHarnesses(): AgentHarness[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM custom_harness ORDER BY name ASC')
    .all() as HarnessRow[];
  return rows.map(rowToHarness);
}

export function getCustomHarness(id: string): AgentHarness | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(id) as HarnessRow | undefined;
  return row ? rowToHarness(row) : undefined;
}

export function createCustomHarness(input: Omit<AgentHarness, 'isBuiltIn'>): AgentHarness {
  const db = getDb();
  db.prepare(
    `INSERT INTO custom_harness (id, name, domain, description, system_prompt, allowed_tools_json, constraints_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.domain,
    input.description,
    input.systemPrompt,
    JSON.stringify(input.allowedTools),
    JSON.stringify(input.constraints ?? {}),
  );
  return getCustomHarness(input.id)!;
}

export function updateCustomHarness(id: string, input: Partial<AgentHarness>): AgentHarness | undefined {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(id) as HarnessRow | undefined;
  if (!existing) return undefined;

  const name = input.name ?? existing.name;
  const domain = input.domain ?? existing.domain;
  const description = input.description ?? existing.description;
  const systemPrompt = input.systemPrompt ?? existing.system_prompt;
  const allowedTools = input.allowedTools !== undefined
    ? JSON.stringify(input.allowedTools)
    : existing.allowed_tools_json;
  const constraints = input.constraints !== undefined
    ? JSON.stringify(input.constraints)
    : existing.constraints_json;

  db.prepare(
    `UPDATE custom_harness SET name = ?, domain = ?, description = ?, system_prompt = ?,
     allowed_tools_json = ?, constraints_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, domain, description, systemPrompt, allowedTools, constraints, id);

  return getCustomHarness(id);
}

export function deleteCustomHarness(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_harness WHERE id = ?').run(id);
  return result.changes > 0;
}
