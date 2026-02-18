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
  if (workspaceId) {
    return db
      .prepare('SELECT * FROM session WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(workspaceId) as SessionRow[];
  }
  return db.prepare('SELECT * FROM session ORDER BY updated_at DESC').all() as SessionRow[];
}

export function getSession(id: string): SessionRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
}

export function createSession(params: {
  workspaceId: string;
  title?: string;
  provider?: string;
  model?: string;
  thinkingMode?: string;
}): SessionRow {
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO session (id, workspace_id, title, provider, model, thinking_mode)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.workspaceId,
    params.title ?? null,
    params.provider ?? 'anthropic',
    params.model ?? 'claude-sonnet-4-5-20250929',
    params.thinkingMode ?? 'none',
  );
  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM session WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare("UPDATE session SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    title,
    id,
  );
}

export function touchSession(id: string): void {
  const db = getDb();
  db.prepare("UPDATE session SET updated_at = datetime('now') WHERE id = ?").run(id);
}

// --- Messages ---

export function listMessages(sessionId: string): MessageRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MessageRow[];
}

export function addMessage(params: {
  sessionId: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}): MessageRow {
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO message (id, session_id, role, content, metadata)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, params.sessionId, params.role, params.content, JSON.stringify(params.metadata ?? null));
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
  const db = getDb();
  return db.prepare('SELECT * FROM workspace WHERE id = ?').get(id) as WorkspaceRow | undefined;
}

export function createWorkspace(params: {
  name: string;
  path?: string;
  type?: string;
}): WorkspaceRow {
  const db = getDb();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO workspace (id, name, path, type) VALUES (?, ?, ?, ?)`,
  ).run(id, params.name, params.path ?? null, params.type ?? 'local');
  return getWorkspace(id)!;
}

export function updateWorkspace(
  id: string,
  params: { name?: string; path?: string },
): WorkspaceRow | undefined {
  const db = getDb();
  const ws = getWorkspace(id);
  if (!ws) return undefined;
  db.prepare(
    `UPDATE workspace SET name = ?, path = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(params.name ?? ws.name, params.path ?? ws.path, id);
  return getWorkspace(id);
}

export function deleteWorkspace(id: string): boolean {
  if (id === 'default') return false; // Protect the default workspace
  const db = getDb();
  const result = db.prepare('DELETE FROM workspace WHERE id = ?').run(id);
  return result.changes > 0;
}
