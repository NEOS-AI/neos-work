/**
 * Session and message CRUD operations.
 */

import { nanoid } from 'nanoid';

import { getDb } from './schema.js';

export interface SessionRow {
  id: string;
  workspace_id: string;
  title: string | null;
  provider: string;
  model: string;
  thinking_mode: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

const THINKING_MODES = new Set(['none', 'low', 'medium', 'high']);
const WORKSPACE_TYPES = new Set(['local', 'remote']);
/** Practical bound for session / workspace / message ids (nanoid / UUID). */
const LOOKUP_ID_MAX_CHARS = 100;
/** Cap session title length (UI list hygiene). */
const SESSION_TITLE_MAX = 200;

/** Trim + reject blank / control-char / overlong lookup ids. */
function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim — trim() strips leading/trailing \r\n
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

// --- Sessions ---

export function listSessions(workspaceId?: string): SessionRow[] {
  const db = getDb();
  // Drop unsafe filter (list all when invalid) — matches route safeRouteId
  const ws =
    workspaceId !== undefined && workspaceId !== null && workspaceId !== ''
      ? safeLookupId(workspaceId) || undefined
      : undefined;
  if (ws) {
    return db
      .prepare('SELECT * FROM session WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(ws) as SessionRow[];
  }
  return db.prepare('SELECT * FROM session ORDER BY updated_at DESC').all() as SessionRow[];
}

export function getSession(id: string): SessionRow | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  return db.prepare('SELECT * FROM session WHERE id = ?').get(trimmed) as SessionRow | undefined;
}

export function createSession(params: {
  workspaceId: string;
  title?: string;
  provider?: string;
  model?: string;
  thinkingMode?: string;
}): SessionRow {
  const workspaceId = safeLookupId(params.workspaceId);
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }
  let title: string | null = null;
  if (params.title !== undefined) {
    if (typeof params.title === 'string') {
      // Reject control chars before trim (list/UI hygiene)
      if (/[\0\r\n]/.test(params.title)) {
        throw new Error('title contains invalid control characters');
      }
      title = params.title.trim() || null;
    }
  }
  if (title && title.length > SESSION_TITLE_MAX) {
    title = title.slice(0, SESSION_TITLE_MAX);
  }
  // Control-char before trim so leading \n cannot strip to a known provider
  const providerRaw0 = typeof params.provider === 'string' ? params.provider : '';
  const providerRaw =
    providerRaw0 && !/[\0\r\n]/.test(providerRaw0)
      ? providerRaw0.trim().toLowerCase()
      : '';
  // Known chat providers; unknown/blank → anthropic default
  const provider =
    providerRaw === 'anthropic' || providerRaw === 'google' || providerRaw === 'openai'
      ? providerRaw
      : 'anthropic';
  // Cap model id length; reject control chars before trim
  let model = 'claude-sonnet-4-5-20250929';
  if (typeof params.model === 'string') {
    if (!/[\0\r\n]/.test(params.model) && params.model.trim().length <= 200) {
      model = params.model.trim() || 'claude-sonnet-4-5-20250929';
    }
  }
  const thinkingRaw0 =
    typeof params.thinkingMode === 'string' ? params.thinkingMode : '';
  const thinkingRaw =
    thinkingRaw0 && !/[\0\r\n]/.test(thinkingRaw0)
      ? thinkingRaw0.trim().toLowerCase()
      : '';
  const thinkingMode = THINKING_MODES.has(thinkingRaw) ? thinkingRaw : 'none';
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO session (id, workspace_id, title, provider, model, thinking_mode)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, title, provider, model, thinkingMode);
  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM session WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function updateSessionTitle(id: string, title: string): void {
  const trimmed = safeLookupId(id);
  if (!trimmed) return;
  const db = getDb();
  // Drop control-char titles rather than persisting them (check before trim)
  let name = '';
  if (typeof title === 'string' && !/[\0\r\n]/.test(title)) {
    name = title.trim();
  }
  if (name.length > SESSION_TITLE_MAX) name = name.slice(0, SESSION_TITLE_MAX);
  db.prepare("UPDATE session SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    name || null,
    trimmed,
  );
}

export function touchSession(id: string): void {
  const trimmed = safeLookupId(id);
  if (!trimmed) return;
  const db = getDb();
  db.prepare("UPDATE session SET updated_at = datetime('now') WHERE id = ?").run(trimmed);
}

// --- Messages ---

export function listMessages(sessionId: string): MessageRow[] {
  const trimmed = safeLookupId(sessionId);
  if (!trimmed) return [];
  const db = getDb();
  return db
    .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC')
    .all(trimmed) as MessageRow[];
}

const MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);
/** Cap chat message body (runaway paste / tool dump defense). */
export const MESSAGE_CONTENT_MAX_CHARS = 1 * 1024 * 1024;
/** Cap serialized metadata JSON. */
export const MESSAGE_METADATA_MAX_CHARS = 64 * 1024;

export function addMessage(params: {
  sessionId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}): MessageRow {
  const sessionId = safeLookupId(params.sessionId);
  if (!sessionId) throw new Error('sessionId is required');
  // Control-char before trim so leading \n cannot strip to a valid role
  const roleRaw0 = typeof params.role === 'string' ? params.role : '';
  if (/[\0\r\n]/.test(roleRaw0)) {
    throw new Error('role must be user|assistant|system|tool');
  }
  const roleRaw = roleRaw0.trim().toLowerCase();
  if (!roleRaw || !MESSAGE_ROLES.has(roleRaw)) {
    throw new Error('role must be user|assistant|system|tool');
  }
  // Preserve intentional whitespace in chat content; only coerce non-strings
  const content = typeof params.content === 'string' ? params.content : String(params.content ?? '');
  // Null bytes break DB storage and LLM request JSON
  if (/\0/.test(content)) {
    throw new Error('content contains invalid control characters');
  }
  if (content.length > MESSAGE_CONTENT_MAX_CHARS) {
    throw new Error(`content exceeds max size (${MESSAGE_CONTENT_MAX_CHARS} characters)`);
  }
  let metadataStr = JSON.stringify(params.metadata ?? null);
  if (metadataStr.length > MESSAGE_METADATA_MAX_CHARS) {
    metadataStr = JSON.stringify({ truncated: true });
  }
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO message (id, session_id, role, content, metadata)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, roleRaw, content, metadataStr);
  return db.prepare('SELECT * FROM message WHERE id = ?').get(id) as MessageRow;
}

// --- Workspaces ---

export interface WorkspaceRow {
  id: string;
  name: string;
  path: string | null;
  type: string;
  created_at: string;
  updated_at: string;
}

export function listWorkspaces(): WorkspaceRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM workspace ORDER BY created_at ASC').all() as WorkspaceRow[];
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  return db.prepare('SELECT * FROM workspace WHERE id = ?').get(trimmed) as WorkspaceRow | undefined;
}

/** Reject null bytes / CR / LF that confuse path APIs. */
function hasUnsafePathChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

function normalizeWorkspacePath(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  // Coerce non-strings then apply the same control-before-trim hygiene
  const asString = typeof raw === 'string' ? raw : String(raw ?? '');
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (hasUnsafePathChars(asString)) {
    throw new Error('path contains invalid control characters');
  }
  const pathVal = asString.trim();
  if (!pathVal) return null;
  return pathVal;
}

/** Cap workspace display name. */
export const WORKSPACE_NAME_MAX_CHARS = 200;

export function createWorkspace(params: {
  name: string;
  path?: string;
  type?: string;
}): WorkspaceRow {
  const nameRaw = typeof params.name === 'string' ? params.name : '';
  // Control-char check before trim
  if (hasUnsafePathChars(nameRaw)) {
    throw new Error('name contains invalid control characters');
  }
  const name = nameRaw.trim();
  if (!name) throw new Error('name is required');
  if (name.length > WORKSPACE_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${WORKSPACE_NAME_MAX_CHARS})`);
  }
  const pathVal = normalizeWorkspacePath(params.path);
  const typeRaw =
    typeof params.type === 'string' && !hasUnsafePathChars(params.type)
      ? params.type.trim().toLowerCase()
      : '';
  const type = WORKSPACE_TYPES.has(typeRaw) ? typeRaw : 'local';
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO workspace (id, name, path, type) VALUES (?, ?, ?, ?)`,
  ).run(id, name, pathVal, type);
  return getWorkspace(id)!;
}

export function updateWorkspace(
  id: string,
  params: { name?: string; path?: string },
): WorkspaceRow | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const ws = getWorkspace(trimmed);
  if (!ws) return undefined;
  let name = ws.name;
  if (params.name !== undefined) {
    if (typeof params.name !== 'string' || hasUnsafePathChars(params.name)) return undefined;
    name = params.name.trim();
  }
  if (!name || name.length > WORKSPACE_NAME_MAX_CHARS) return undefined;
  let pathVal = ws.path;
  if (params.path !== undefined) {
    try {
      pathVal = normalizeWorkspacePath(params.path);
    } catch {
      return undefined; // invalid path leaves row unchanged
    }
  }
  db.prepare(
    `UPDATE workspace SET name = ?, path = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name, pathVal, trimmed);
  return getWorkspace(trimmed);
}

export function deleteWorkspace(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed || trimmed === 'default') return false; // Protect the default workspace
  const db = getDb();
  const result = db.prepare('DELETE FROM workspace WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
