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

// --- Sessions ---

export function listSessions(workspaceId?: string): SessionRow[] {
  const db = getDb();
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() || undefined : undefined;
  if (ws) {
    return db
      .prepare('SELECT * FROM session WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(ws) as SessionRow[];
  }
  return db.prepare('SELECT * FROM session ORDER BY updated_at DESC').all() as SessionRow[];
}

export function getSession(id: string): SessionRow | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
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
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId.trim() : '';
  if (!workspaceId) {
    throw new Error('workspaceId is required');
  }
  const title =
    params.title !== undefined
      ? (typeof params.title === 'string' ? params.title.trim() || null : null)
      : null;
  const provider =
    typeof params.provider === 'string' ? params.provider.trim() || 'anthropic' : (params.provider ?? 'anthropic');
  const model =
    typeof params.model === 'string' ? params.model.trim() || 'claude-sonnet-4-5-20250929' : (params.model ?? 'claude-sonnet-4-5-20250929');
  const thinkingMode =
    typeof params.thinkingMode === 'string'
      ? params.thinkingMode.trim() || 'none'
      : (params.thinkingMode ?? 'none');
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO session (id, workspace_id, title, provider, model, thinking_mode)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, title, provider, model, thinkingMode);
  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM session WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function updateSessionTitle(id: string, title: string): void {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return;
  const db = getDb();
  const name = typeof title === 'string' ? title.trim() : '';
  db.prepare("UPDATE session SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    name || null,
    trimmed,
  );
}

export function touchSession(id: string): void {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return;
  const db = getDb();
  db.prepare("UPDATE session SET updated_at = datetime('now') WHERE id = ?").run(trimmed);
}

// --- Messages ---

export function listMessages(sessionId: string): MessageRow[] {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!trimmed) return [];
  const db = getDb();
  return db
    .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC')
    .all(trimmed) as MessageRow[];
}

const MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

export function addMessage(params: {
  sessionId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}): MessageRow {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
  if (!sessionId) throw new Error('sessionId is required');
  const roleRaw = typeof params.role === 'string' ? params.role.trim().toLowerCase() : '';
  if (!roleRaw || !MESSAGE_ROLES.has(roleRaw)) {
    throw new Error('role must be user|assistant|system|tool');
  }
  // Preserve intentional whitespace in chat content; only coerce non-strings
  const content = typeof params.content === 'string' ? params.content : String(params.content ?? '');
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO message (id, session_id, role, content, metadata)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, roleRaw, content, JSON.stringify(params.metadata ?? null));
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
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  return db.prepare('SELECT * FROM workspace WHERE id = ?').get(trimmed) as WorkspaceRow | undefined;
}

export function createWorkspace(params: {
  name: string;
  path?: string;
  type?: string;
}): WorkspaceRow {
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) throw new Error('name is required');
  const pathVal =
    typeof params.path === 'string' ? params.path.trim() || null : (params.path ?? null);
  const type =
    typeof params.type === 'string' ? params.type.trim() || 'local' : (params.type ?? 'local');
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
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const ws = getWorkspace(trimmed);
  if (!ws) return undefined;
  const name =
    params.name !== undefined
      ? (typeof params.name === 'string' ? params.name.trim() : '')
      : ws.name;
  if (!name) return undefined;
  const pathVal =
    params.path !== undefined
      ? (typeof params.path === 'string' ? params.path.trim() || null : params.path)
      : ws.path;
  db.prepare(
    `UPDATE workspace SET name = ?, path = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name, pathVal, trimmed);
  return getWorkspace(trimmed);
}

export function deleteWorkspace(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed || trimmed === 'default') return false; // Protect the default workspace
  const db = getDb();
  const result = db.prepare('DELETE FROM workspace WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
