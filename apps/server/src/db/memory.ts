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
  ).run(id, params.workspaceId, params.key, params.content, tagsStr);
  return getMemory(params.workspaceId, params.key)!;
}

export function getMemory(workspaceId: string, key: string): MemoryRow | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM memory WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, key) as MemoryRow | undefined;
}

export function searchMemory(
  workspaceId: string,
  query: string,
  tags?: string[],
  limit = 10,
): MemoryRow[] {
  const db = getDb();
  const like = `%${query}%`;
  let rows = db
    .prepare(
      `SELECT * FROM memory WHERE workspace_id = ?
       AND (content LIKE ? OR key LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(workspaceId, like, like, limit) as MemoryRow[];

  if (tags && tags.length > 0) {
    rows = rows.filter((r) => {
      if (!r.tags) return false;
      try {
        const memTags: string[] = JSON.parse(r.tags);
        return tags.some((t) => memTags.includes(t));
      } catch {
        return false;
      }
    });
  }

  return rows;
}

export function listMemories(workspaceId: string, limit = 20): MemoryRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM memory WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(workspaceId, limit) as MemoryRow[];
}

export function deleteMemory(workspaceId: string, key: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM memory WHERE workspace_id = ? AND key = ?')
    .run(workspaceId, key);
  return result.changes > 0;
}
