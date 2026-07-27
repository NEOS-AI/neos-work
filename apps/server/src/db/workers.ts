/**
 * Custom DomainWorker CRUD (SQLite) — table `workers` (v0.4 Q1 rename from custom_harness).
 *
 * Deprecated aliases `listCustomHarnesses` etc. re-export from ./harnesses.ts for
 * older imports; this module is the source of truth.
 */

import { getDb } from './schema.js';
import type { DomainWorker, ToolPermissionProfile, WorkerMode, WorkspacePolicy } from '@neos-work/shared';

interface WorkerRow {
  id: string;
  name: string;
  domain: string;
  description: string;
  system_prompt: string;
  allowed_tools_json: string;
  constraints_json: string;
  permission_profile?: string | null;
  workspace_json?: string | null;
  default_mode?: string | null;
  created_at: string;
  updated_at: string;
}

const LOOKUP_ID_MAX_CHARS = 100;
export const WORKER_SYSTEM_PROMPT_MAX_CHARS = 100_000;
export const WORKER_DESCRIPTION_MAX_CHARS = 2_000;
export const WORKER_NAME_MAX_CHARS = 200;
export const WORKER_ALLOWED_TOOLS_MAX = 100;
export const WORKER_TOOL_NAME_MAX_CHARS = 100;
export const WORKER_CONSTRAINTS_JSON_MAX_CHARS = 16 * 1024;

// Deprecated constant aliases (harness module re-exports)
export const HARNESS_SYSTEM_PROMPT_MAX_CHARS = WORKER_SYSTEM_PROMPT_MAX_CHARS;
export const HARNESS_DESCRIPTION_MAX_CHARS = WORKER_DESCRIPTION_MAX_CHARS;
export const HARNESS_NAME_MAX_CHARS = WORKER_NAME_MAX_CHARS;
export const HARNESS_ALLOWED_TOOLS_MAX = WORKER_ALLOWED_TOOLS_MAX;
export const HARNESS_TOOL_NAME_MAX_CHARS = WORKER_TOOL_NAME_MAX_CHARS;
export const HARNESS_CONSTRAINTS_JSON_MAX_CHARS = WORKER_CONSTRAINTS_JSON_MAX_CHARS;

const BUILT_IN_DOMAINS = new Set(['finance', 'coding', 'research', 'general']);
const PERMISSION_PROFILES = new Set<ToolPermissionProfile>([
  'read_only',
  'read_write',
  'execute',
  'network',
  'full',
]);
const WORKER_MODES = new Set<WorkerMode>(['solo', 'coordinator']);

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => String(t ?? ''))
      .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeParseConstraints(raw: string): DomainWorker['constraints'] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DomainWorker['constraints'];
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeDomain(raw: unknown, fallback = 'general'): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return fallback;
  const domainRaw = raw.trim().toLowerCase() || fallback;
  return BUILT_IN_DOMAINS.has(domainRaw) ? domainRaw : 'general';
}

function normalizePermissionProfile(raw: unknown): ToolPermissionProfile | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const p = raw.trim().toLowerCase() as ToolPermissionProfile;
  return PERMISSION_PROFILES.has(p) ? p : undefined;
}

function normalizeDefaultMode(raw: unknown): WorkerMode | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const m = raw.trim().toLowerCase() as WorkerMode;
  return WORKER_MODES.has(m) ? m : undefined;
}

function normalizeWorkspace(raw: unknown): WorkspacePolicy | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return normalizeWorkspace(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const kind = (raw as WorkspacePolicy).kind;
  if (kind === 'none' || kind === 'isolated') return { kind };
  if (kind === 'run') {
    const subdir = (raw as { subdir?: unknown }).subdir;
    if (typeof subdir === 'string' && subdir.trim() && !/[\0\r\n]/.test(subdir)) {
      return { kind: 'run', subdir: subdir.trim().slice(0, 200) };
    }
    return { kind: 'run' };
  }
  return undefined;
}

function rowToWorker(row: WorkerRow): DomainWorker {
  const permissionProfile = normalizePermissionProfile(row.permission_profile ?? undefined);
  const workspace = row.workspace_json
    ? normalizeWorkspace(row.workspace_json)
    : undefined;
  const defaultMode = normalizeDefaultMode(row.default_mode ?? undefined);
  return {
    id: row.id,
    name: row.name,
    domain: normalizeDomain(row.domain),
    description: row.description,
    systemPrompt: row.system_prompt,
    allowedTools: safeParseJsonArray(row.allowed_tools_json),
    constraints: safeParseConstraints(row.constraints_json),
    isBuiltIn: false,
    ...(permissionProfile ? { permissionProfile } : {}),
    ...(workspace ? { workspace } : {}),
    ...(defaultMode ? { defaultMode } : {}),
  };
}

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

function normalizeAllowedTools(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : [])
    .map((t) => String(t ?? ''))
    .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= WORKER_TOOL_NAME_MAX_CHARS);
  return list.slice(0, WORKER_ALLOWED_TOOLS_MAX);
}

function normalizeConstraints(raw: unknown): DomainWorker['constraints'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as DomainWorker['constraints'];
  }
  return {};
}

function serializeConstraints(constraints: DomainWorker['constraints']): string {
  const json = JSON.stringify(constraints);
  if (json.length > WORKER_CONSTRAINTS_JSON_MAX_CHARS) {
    throw new Error(
      `constraints exceed max size (${WORKER_CONSTRAINTS_JSON_MAX_CHARS} characters)`,
    );
  }
  return json;
}

export function listCustomWorkers(domain?: string): DomainWorker[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workers ORDER BY name ASC')
    .all() as WorkerRow[];
  const all = rows.map(rowToWorker);
  if (typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)) {
    const d = domain.trim().toLowerCase();
    return all.filter((w) => w.domain === d);
  }
  return all;
}

export function getCustomWorker(id: string): DomainWorker | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workers WHERE id = ?')
    .get(trimmed) as WorkerRow | undefined;
  return row ? rowToWorker(row) : undefined;
}

export function createCustomWorker(
  input: Omit<DomainWorker, 'isBuiltIn'> & { id: string },
): DomainWorker {
  const idRaw = typeof input.id === 'string' ? input.id : '';
  if (/[\0\r\n]/.test(idRaw)) {
    throw new Error('id contains invalid control characters');
  }
  const id = idRaw.trim();
  const nameRaw = typeof input.name === 'string' ? input.name : '';
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
  if (name.length > WORKER_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${WORKER_NAME_MAX_CHARS})`);
  }
  if (systemPrompt.length > WORKER_SYSTEM_PROMPT_MAX_CHARS) {
    throw new Error(
      `systemPrompt exceeds max size (${WORKER_SYSTEM_PROMPT_MAX_CHARS} characters)`,
    );
  }
  const domain = normalizeDomain(input.domain);
  let description = '';
  if (typeof input.description === 'string') {
    description = input.description.replace(/[\0\r\n]/g, ' ').trim();
  } else if (input.description != null) {
    description = String(input.description ?? '');
  }
  if (description.length > WORKER_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, WORKER_DESCRIPTION_MAX_CHARS);
  }
  const allowedTools = normalizeAllowedTools(input.allowedTools);
  const constraints = normalizeConstraints(input.constraints);
  const constraintsJson = serializeConstraints(constraints);
  const permissionProfile = normalizePermissionProfile(input.permissionProfile) ?? 'full';
  const workspace = normalizeWorkspace(input.workspace);
  const defaultMode = normalizeDefaultMode(input.defaultMode) ?? 'solo';
  const workspaceJson = workspace ? JSON.stringify(workspace) : null;

  const db = getDb();
  db.prepare(
    `INSERT INTO workers (
      id, name, domain, description, system_prompt, allowed_tools_json, constraints_json,
      permission_profile, workspace_json, default_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    domain,
    description,
    systemPrompt,
    JSON.stringify(allowedTools),
    constraintsJson,
    permissionProfile,
    workspaceJson,
    defaultMode,
  );
  return getCustomWorker(id)!;
}

export function updateCustomWorker(
  id: string,
  input: Partial<DomainWorker>,
): DomainWorker | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM workers WHERE id = ?')
    .get(trimmed) as WorkerRow | undefined;
  if (!existing) return undefined;

  let name = existing.name;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name)) return undefined;
    name = input.name.trim();
  }
  if (!name || name.length > WORKER_NAME_MAX_CHARS) return undefined;

  let systemPrompt = existing.system_prompt;
  if (input.systemPrompt !== undefined) {
    if (typeof input.systemPrompt !== 'string' || /[\0\r\n]/.test(input.systemPrompt)) {
      return undefined;
    }
    systemPrompt = input.systemPrompt.trim();
  }
  if (!systemPrompt) return undefined;
  if (systemPrompt.length > WORKER_SYSTEM_PROMPT_MAX_CHARS) return undefined;

  const domain =
    input.domain !== undefined
      ? normalizeDomain(input.domain, existing.domain)
      : existing.domain;

  let description = existing.description;
  if (input.description !== undefined) {
    if (typeof input.description === 'string') {
      description = input.description.replace(/[\0\r\n]/g, ' ').trim();
    } else {
      description = '';
    }
  }
  if (typeof description === 'string' && description.length > WORKER_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, WORKER_DESCRIPTION_MAX_CHARS);
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

  let permissionProfile = existing.permission_profile ?? 'full';
  if (input.permissionProfile !== undefined) {
    permissionProfile = normalizePermissionProfile(input.permissionProfile) ?? 'full';
  }

  let workspaceJson = existing.workspace_json ?? null;
  if (input.workspace !== undefined) {
    const ws = normalizeWorkspace(input.workspace);
    workspaceJson = ws ? JSON.stringify(ws) : null;
  }

  let defaultMode = existing.default_mode ?? 'solo';
  if (input.defaultMode !== undefined) {
    defaultMode = normalizeDefaultMode(input.defaultMode) ?? 'solo';
  }

  db.prepare(
    `UPDATE workers SET name = ?, domain = ?, description = ?, system_prompt = ?,
     allowed_tools_json = ?, constraints_json = ?,
     permission_profile = ?, workspace_json = ?, default_mode = ?,
     updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    name,
    domain,
    description,
    systemPrompt,
    allowedTools,
    constraints,
    permissionProfile,
    workspaceJson,
    defaultMode,
    trimmed,
  );

  return getCustomWorker(trimmed);
}

export function deleteCustomWorker(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM workers WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

// ── Deprecated harness aliases ──────────────────────────────

/** @deprecated Use listCustomWorkers */
export const listCustomHarnesses = listCustomWorkers;
/** @deprecated Use getCustomWorker */
export const getCustomHarness = getCustomWorker;
/** @deprecated Use createCustomWorker */
export const createCustomHarness = createCustomWorker;
/** @deprecated Use updateCustomWorker */
export const updateCustomHarness = updateCustomWorker;
/** @deprecated Use deleteCustomWorker */
export const deleteCustomHarness = deleteCustomWorker;
