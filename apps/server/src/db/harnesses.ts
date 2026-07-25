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

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Control-char check before trim (align with normalizeAllowedTools)
    return parsed
      .map((t) => String(t ?? ''))
      .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeParseConstraints(raw: string): AgentHarness['constraints'] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AgentHarness['constraints'];
    }
    return {};
  } catch {
    return {};
  }
}

function rowToHarness(row: HarnessRow): AgentHarness {
  return {
    id: row.id,
    name: row.name,
    domain: normalizeHarnessDomain(row.domain),
    description: row.description,
    systemPrompt: row.system_prompt,
    allowedTools: safeParseJsonArray(row.allowed_tools_json),
    constraints: safeParseConstraints(row.constraints_json),
    isBuiltIn: false,
  };
}

/** Practical bound for harness lookup ids. */
const LOOKUP_ID_MAX_CHARS = 100;

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

export function listCustomHarnesses(): AgentHarness[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM custom_harness ORDER BY name ASC')
    .all() as HarnessRow[];
  return rows.map(rowToHarness);
}

export function getCustomHarness(id: string): AgentHarness | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(trimmed) as HarnessRow | undefined;
  return row ? rowToHarness(row) : undefined;
}

function normalizeHarnessDomain(raw: unknown, fallback: AgentHarness['domain'] = 'general'): AgentHarness['domain'] {
  // Control-char domain → fallback (check before trim)
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return fallback;
  const domainRaw = raw.trim().toLowerCase() || fallback;
  return (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as AgentHarness['domain'])
    : 'general';
}

/** Cap harness system prompt (plan multi-LLM / harness polish). */
export const HARNESS_SYSTEM_PROMPT_MAX_CHARS = 100_000;
/** Cap harness description. */
export const HARNESS_DESCRIPTION_MAX_CHARS = 2_000;
/** Cap harness display name. */
export const HARNESS_NAME_MAX_CHARS = 200;
/** Cap allowed tool names list size. */
export const HARNESS_ALLOWED_TOOLS_MAX = 100;
/** Cap single allowed tool name length. */
export const HARNESS_TOOL_NAME_MAX_CHARS = 100;
/** Cap serialized constraints JSON. */
export const HARNESS_CONSTRAINTS_JSON_MAX_CHARS = 16 * 1024;

function normalizeAllowedTools(raw: unknown): string[] {
  // Control-char check before trim so "\nread" is dropped, not accepted as "read"
  const list = (Array.isArray(raw) ? raw : [])
    .map((t) => String(t ?? ''))
    .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= HARNESS_TOOL_NAME_MAX_CHARS);
  return list.slice(0, HARNESS_ALLOWED_TOOLS_MAX);
}

function normalizeConstraints(raw: unknown): AgentHarness['constraints'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as AgentHarness['constraints'];
  }
  return {};
}

function serializeConstraints(constraints: AgentHarness['constraints']): string {
  const json = JSON.stringify(constraints);
  if (json.length > HARNESS_CONSTRAINTS_JSON_MAX_CHARS) {
    throw new Error(
      `constraints exceed max size (${HARNESS_CONSTRAINTS_JSON_MAX_CHARS} characters)`,
    );
  }
  return json;
}

export function createCustomHarness(input: Omit<AgentHarness, 'isBuiltIn'>): AgentHarness {
  const idRaw = typeof input.id === 'string' ? input.id : '';
  // Control-char check before trim
  if (/[\0\r\n]/.test(idRaw)) {
    throw new Error('id contains invalid control characters');
  }
  const id = idRaw.trim();
  const nameRaw = typeof input.name === 'string' ? input.name : '';
  // Control-char check before trim
  if (/[\0\r\n]/.test(nameRaw)) {
    throw new Error('name contains invalid control characters');
  }
  const name = nameRaw.trim();
  const systemPromptRaw =
    typeof input.systemPrompt === 'string' ? input.systemPrompt : '';
  if (/[\0\r\n]/.test(systemPromptRaw)) {
    throw new Error('systemPrompt contains invalid control characters');
  }
  const systemPrompt = systemPromptRaw.trim();
  if (!id || !name || !systemPrompt) {
    throw new Error('id, name, and systemPrompt are required');
  }
  if (id.length > LOOKUP_ID_MAX_CHARS) {
    throw new Error(`id exceeds max length (${LOOKUP_ID_MAX_CHARS})`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('id must be alphanumeric (- and _ allowed)');
  }
  if (name.length > HARNESS_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${HARNESS_NAME_MAX_CHARS})`);
  }
  if (systemPrompt.length > HARNESS_SYSTEM_PROMPT_MAX_CHARS) {
    throw new Error(
      `systemPrompt exceeds max size (${HARNESS_SYSTEM_PROMPT_MAX_CHARS} characters)`,
    );
  }
  const domain = normalizeHarnessDomain(input.domain);
  // Collapse control chars before trim so leading/trailing \r\n are not silently stripped
  let description = '';
  if (typeof input.description === 'string') {
    description = input.description.replace(/[\0\r\n]/g, ' ').trim();
  } else if (input.description != null) {
    description = String(input.description ?? '');
  }
  if (description.length > HARNESS_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, HARNESS_DESCRIPTION_MAX_CHARS);
  }
  const allowedTools = normalizeAllowedTools(input.allowedTools);
  const constraints = normalizeConstraints(input.constraints);
  const constraintsJson = serializeConstraints(constraints);
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
    constraintsJson,
  );
  return getCustomHarness(id)!;
}

export function updateCustomHarness(id: string, input: Partial<AgentHarness>): AgentHarness | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM custom_harness WHERE id = ?')
    .get(trimmed) as HarnessRow | undefined;
  if (!existing) return undefined;

  let name = existing.name;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name)) return undefined;
    name = input.name.trim();
  }
  // Blank name after trim is invalid — leave row unchanged
  if (!name || name.length > HARNESS_NAME_MAX_CHARS) return undefined;
  let systemPrompt = existing.system_prompt;
  if (input.systemPrompt !== undefined) {
    if (typeof input.systemPrompt !== 'string' || /[\0\r\n]/.test(input.systemPrompt)) {
      return undefined;
    }
    systemPrompt = input.systemPrompt.trim();
  }
  if (!systemPrompt) return undefined;
  if (systemPrompt.length > HARNESS_SYSTEM_PROMPT_MAX_CHARS) return undefined;
  const domain =
    input.domain !== undefined
      ? normalizeHarnessDomain(input.domain, existing.domain as AgentHarness['domain'])
      : existing.domain;
  let description = existing.description;
  if (input.description !== undefined) {
    if (typeof input.description === 'string') {
      // Always collapse control chars before trim (leading \n must not be stripped silently)
      description = input.description.replace(/[\0\r\n]/g, ' ').trim();
    } else {
      description = '';
    }
  }
  if (typeof description === 'string' && description.length > HARNESS_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, HARNESS_DESCRIPTION_MAX_CHARS);
  }
  const allowedTools =
    input.allowedTools !== undefined
      ? JSON.stringify(normalizeAllowedTools(input.allowedTools))
      : existing.allowed_tools_json;
  let constraints: string;
  try {
    constraints =
      input.constraints !== undefined
        ? serializeConstraints(normalizeConstraints(input.constraints))
        : existing.constraints_json;
  } catch {
    return undefined;
  }

  db.prepare(
    `UPDATE custom_harness SET name = ?, domain = ?, description = ?, system_prompt = ?,
     allowed_tools_json = ?, constraints_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, domain, description, systemPrompt, allowedTools, constraints, trimmed);

  return getCustomHarness(trimmed);
}

export function deleteCustomHarness(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_harness WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
