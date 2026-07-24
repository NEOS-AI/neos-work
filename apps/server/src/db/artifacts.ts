/**
 * Artifact CRUD — read/write the `artifacts` table.
 */

import { getDb } from './schema.js';

export interface ArtifactRow {
  id: string;
  workflow_id: string;
  run_id: string | null;
  name: string;
  content_type: string;
  content: string | null;
  file_path: string | null;
  node_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  workflowId: string;
  runId?: string;
  name: string;
  contentType: string;
  content?: string;
  filePath?: string;
  nodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactInput {
  workflowId: string;
  runId?: string;
  name: string;
  contentType: string;
  content?: string;
  filePath?: string;
  nodeId?: string;
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    runId: row.run_id ?? undefined,
    name: row.name,
    contentType: row.content_type,
    content: row.content ?? undefined,
    filePath: row.file_path ?? undefined,
    nodeId: row.node_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createArtifact(input: CreateArtifactInput): Artifact {
  const workflowId = typeof input.workflowId === 'string' ? input.workflowId.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  // MIME types are case-insensitive; normalize to lower-case for consistent matching
  const contentType =
    typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : '';
  if (!workflowId || !name || !contentType) {
    throw new Error('workflowId, name, and contentType are required');
  }
  const runId =
    typeof input.runId === 'string' ? input.runId.trim() || null : (input.runId ?? null);
  const nodeId =
    typeof input.nodeId === 'string' ? input.nodeId.trim() || null : (input.nodeId ?? null);
  const filePath =
    typeof input.filePath === 'string' ? input.filePath.trim() || null : (input.filePath ?? null);
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO artifacts (id, workflow_id, run_id, name, content_type, content, file_path, node_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, runId, name, contentType, input.content ?? null, filePath, nodeId);
  return getArtifact(id)!;
}

export function getArtifact(id: string): Artifact | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(trimmed) as ArtifactRow | undefined;
  return row ? rowToArtifact(row) : undefined;
}

export function listArtifacts(workflowId: string): Artifact[] {
  const trimmed = typeof workflowId === 'string' ? workflowId.trim() : '';
  if (!trimmed) return [];
  const db = getDb();
  const rows = db.prepare('SELECT * FROM artifacts WHERE workflow_id = ? ORDER BY created_at DESC').all(trimmed) as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function listArtifactsByRun(runId: string): Artifact[] {
  const trimmed = typeof runId === 'string' ? runId.trim() : '';
  if (!trimmed) return [];
  const db = getDb();
  const rows = db.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at DESC').all(trimmed) as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function deleteArtifact(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM artifacts WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function updateArtifactContent(id: string, content: string): Artifact | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  db.prepare(`UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`).run(content, trimmed);
  return getArtifact(trimmed);
}

/** Plan Task 4 — PATCH name and/or content. */
export function updateArtifact(
  id: string,
  input: { name?: string; content?: string },
): Artifact | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  const existing = getArtifact(trimmed);
  if (!existing) return undefined;
  const db = getDb();
  const name =
    input.name !== undefined
      ? (typeof input.name === 'string' ? input.name.trim() : '')
      : existing.name;
  if (!name) return undefined;
  const content = input.content !== undefined ? input.content : (existing.content ?? null);
  db.prepare(
    `UPDATE artifacts SET name = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name, content, trimmed);
  return getArtifact(trimmed);
}
