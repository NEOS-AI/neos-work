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

export function createMemory(params: {
  workspaceId: string;
  key: string;
  content: string;
  tags?: string[];
}): MemoryRow {
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId.trim() : '';
  const key = typeof params.key === 'string' ? params.key.trim() : '';
  if (!workspaceId || !key) throw new Error('workspaceId and key are required');
  const db = getDb();
  const id = crypto.randomUUID();
  const tagsStr = params.tags ? JSON.stringify(params.tags) : null;
  db.prepare(
    `INSERT INTO memory (id, workspace_id, key, content, tags)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, key) DO UPDATE SET
       content = excluded.content,
       tags = excluded.tags,
       updated_at = datetime('now')`,
  ).run(id, workspaceId, key, params.content, tagsStr);
  return getMemory(workspaceId, key)!;
}

export function getMemory(workspaceId: string, key: string): MemoryRow | undefined {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  const k = typeof key === 'string' ? key.trim() : '';
  if (!ws || !k) return undefined;
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
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!ws) return [];
  const db = getDb();
  const like = `%${String(query ?? '').trim()}%`;
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 100);
  let rows = db
    .prepare(
      `SELECT * FROM memory WHERE workspace_id = ?
       AND (content LIKE ? OR key LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(ws, like, like, capped) as MemoryRow[];

  if (tags && tags.length > 0) {
    const want = tags.map((t) => String(t).trim()).filter(Boolean);
    rows = rows.filter((r) => {
      if (!r.tags) return false;
      try {
        const memTags: string[] = JSON.parse(r.tags);
        return want.some((t) => memTags.includes(t));
      } catch {
        return false;
      }
    });
  }

  return rows;
}

export function listMemories(workspaceId: string, limit = 20): MemoryRow[] {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!ws) return [];
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const db = getDb();
  return db
    .prepare('SELECT * FROM memory WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(ws, capped) as MemoryRow[];
}

export function deleteMemory(workspaceId: string, key: string): boolean {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  const k = typeof key === 'string' ? key.trim() : '';
  if (!ws || !k) return false;
  const db = getDb();
  const result = db
    .prepare('DELETE FROM memory WHERE workspace_id = ? AND key = ?')
    .run(ws, k);
  return result.changes > 0;
}
