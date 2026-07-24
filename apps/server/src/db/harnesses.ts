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
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(trimmed) as HarnessRow | undefined;
  return row ? rowToHarness(row) : undefined;
}

function normalizeHarnessDomain(raw: unknown, fallback: AgentHarness['domain'] = 'general'): AgentHarness['domain'] {
  const domainRaw =
    typeof raw === 'string' ? raw.trim().toLowerCase() || fallback : fallback;
  return (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as AgentHarness['domain'])
    : 'general';
}

export function createCustomHarness(input: Omit<AgentHarness, 'isBuiltIn'>): AgentHarness {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const systemPrompt =
    typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '';
  if (!id || !name || !systemPrompt) {
    throw new Error('id, name, and systemPrompt are required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('id must be alphanumeric (- and _ allowed)');
  }
  const domain = normalizeHarnessDomain(input.domain);
  const description =
    typeof input.description === 'string' ? input.description.trim() : (input.description ?? '');
  const allowedTools = (input.allowedTools ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  const db = getDb();
  db.prepare(
    `INSERT INTO custom_harness (id, name, domain, description, system_prompt, allowed_tools_json, constraints_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    domain,
    description,
    systemPrompt,
    JSON.stringify(allowedTools),
    JSON.stringify(input.constraints ?? {}),
  );
  return getCustomHarness(id)!;
}

export function updateCustomHarness(id: string, input: Partial<AgentHarness>): AgentHarness | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(trimmed) as HarnessRow | undefined;
  if (!existing) return undefined;

  const name =
    input.name !== undefined
      ? (typeof input.name === 'string' ? input.name.trim() : '')
      : existing.name;
  // Blank name after trim is invalid — leave row unchanged
  if (!name) return undefined;
  const systemPrompt =
    input.systemPrompt !== undefined
      ? (typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '')
      : existing.system_prompt;
  if (!systemPrompt) return undefined;
  const domain =
    input.domain !== undefined
      ? normalizeHarnessDomain(input.domain, existing.domain as AgentHarness['domain'])
      : existing.domain;
  const description =
    input.description !== undefined
      ? (typeof input.description === 'string' ? input.description.trim() : '')
      : existing.description;
  const allowedTools = input.allowedTools !== undefined
    ? JSON.stringify(
      input.allowedTools.map((t) => String(t).trim()).filter(Boolean),
    )
    : existing.allowed_tools_json;
  const constraints = input.constraints !== undefined
    ? JSON.stringify(input.constraints)
    : existing.constraints_json;

  db.prepare(
    `UPDATE custom_harness SET name = ?, domain = ?, description = ?, system_prompt = ?,
     allowed_tools_json = ?, constraints_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, domain, description, systemPrompt, allowedTools, constraints, trimmed);

  return getCustomHarness(trimmed);
}

export function deleteCustomHarness(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_harness WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
