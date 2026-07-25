/**
 * CRUD operations for the memory table.
 * Stores workspace-scoped persistent memories for the agent.
 */

import { getDb } from './schema.js';

export interface MemoryRow {
  id: string;
  workspace_id: string;
  key: string;
  content: string;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

/** Reject null bytes / CR / LF in memory keys (path/storage safety). */
function hasUnsafeKeyChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

/** Cap SQLite memory body (align with file-store MEMORY_CONTENT_MAX_CHARS). */
export const MEMORY_DB_CONTENT_MAX_CHARS = 1 * 1024 * 1024;
/** Cap memory key length. */
export const MEMORY_DB_KEY_MAX_CHARS = 200;
/** Cap tags array length and serialized JSON. */
export const MEMORY_DB_TAGS_MAX = 50;
export const MEMORY_DB_TAGS_JSON_MAX_CHARS = 4_000;

/** Cap workspace id lookups (align with session safeLookupId). */
const MEMORY_WORKSPACE_ID_MAX = 100;
/** Cap search query string. */
const MEMORY_SEARCH_QUERY_MAX = 2_000;

function safeWorkspaceId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (hasUnsafeKeyChars(raw)) return '';
  const ws = raw.trim();
  if (!ws || ws.length > MEMORY_WORKSPACE_ID_MAX) return '';
  return ws;
}

export function createMemory(params: {
  workspaceId: string;
  key: string;
  content: string;
  tags?: string[];
}): MemoryRow {
  const keyRaw = typeof params.key === 'string' ? params.key : '';
  const wsRaw = typeof params.workspaceId === 'string' ? params.workspaceId : '';
  // Control-char check before trim
  if (hasUnsafeKeyChars(keyRaw) || hasUnsafeKeyChars(wsRaw)) {
    throw new Error('key/workspaceId contains invalid control characters');
  }
  const key = keyRaw.trim();
  const workspaceId = safeWorkspaceId(params.workspaceId);
  if (!workspaceId || !key) throw new Error('workspaceId and key are required');
  if (key.length > MEMORY_DB_KEY_MAX_CHARS) {
    throw new Error(`key exceeds max length (${MEMORY_DB_KEY_MAX_CHARS})`);
  }
  const content =
    typeof params.content === 'string' ? params.content.trim() : String(params.content ?? '');
  if (/\0/.test(content)) {
    throw new Error('content contains invalid control characters');
  }
  if (content.length > MEMORY_DB_CONTENT_MAX_CHARS) {
    throw new Error(
      `content exceeds max size (${MEMORY_DB_CONTENT_MAX_CHARS} characters)`,
    );
  }
  let tagsStr: string | null = null;
  if (Array.isArray(params.tags)) {
    const tags = params.tags
      .map((t) => String(t))
      .filter((t) => t.length > 0 && !hasUnsafeKeyChars(t))
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, MEMORY_DB_TAGS_MAX);
    const json = JSON.stringify(tags);
    tagsStr = json.length > MEMORY_DB_TAGS_JSON_MAX_CHARS ? JSON.stringify(tags.slice(0, 10)) : json;
  }
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO memory (id, workspace_id, key, content, tags)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, key) DO UPDATE SET
       content = excluded.content,
       tags = excluded.tags,
       updated_at = datetime('now')`,
  ).run(id, workspaceId, key, content, tagsStr);
  return getMemory(workspaceId, key)!;
}

export function getMemory(workspaceId: string, key: string): MemoryRow | undefined {
  const ws = safeWorkspaceId(workspaceId);
  if (typeof key !== 'string' || hasUnsafeKeyChars(key)) return undefined;
  const k = key.trim();
  if (!ws || !k || k.length > MEMORY_DB_KEY_MAX_CHARS) {
    return undefined;
  }
  const db = getDb();
  return db
    .prepare('SELECT * FROM memory WHERE workspace_id = ? AND key = ?')
    .get(ws, k) as MemoryRow | undefined;
}

export function searchMemory(
  workspaceId: string,
  query: string,
  tags?: string[],
  limit = 10,
): MemoryRow[] {
  const ws = safeWorkspaceId(workspaceId);
  if (!ws) return [];
  const db = getDb();
  const qRaw = typeof query === 'string' ? query : String(query ?? '');
  // Drop control-char queries before trim; cap length (LIKE runaway defense)
  if (hasUnsafeKeyChars(qRaw)) return [];
  let q = qRaw.trim();
  if (q.length > MEMORY_SEARCH_QUERY_MAX) q = q.slice(0, MEMORY_SEARCH_QUERY_MAX);
  const like = `%${q}%`;
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 100);
  let rows = db
    .prepare(
      `SELECT * FROM memory WHERE workspace_id = ?
       AND (content LIKE ? OR key LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(ws, like, like, capped) as MemoryRow[];

  if (tags && tags.length > 0) {
    const want = tags
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0 && !hasUnsafeKeyChars(t));
    if (want.length === 0) return [];
    rows = rows.filter((r) => {
      if (!r.tags) return false;
      try {
        const parsed = JSON.parse(r.tags) as unknown;
        if (!Array.isArray(parsed)) return false;
        const memTags = parsed.map((t) => String(t));
        return want.some((t) => memTags.includes(t));
      } catch {
        return false;
      }
    });
  }

  return rows;
}

export function listMemories(workspaceId: string, limit = 20): MemoryRow[] {
  const ws = safeWorkspaceId(workspaceId);
  if (!ws) return [];
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const db = getDb();
  return db
    .prepare('SELECT * FROM memory WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(ws, capped) as MemoryRow[];
}

export function deleteMemory(workspaceId: string, key: string): boolean {
  const ws = safeWorkspaceId(workspaceId);
  if (typeof key !== 'string' || hasUnsafeKeyChars(key)) return false;
  const k = key.trim();
  if (!ws || !k || k.length > MEMORY_DB_KEY_MAX_CHARS) return false;
  const db = getDb();
  const result = db
    .prepare('DELETE FROM memory WHERE workspace_id = ? AND key = ?')
    .run(ws, k);
  return result.changes > 0;
}
