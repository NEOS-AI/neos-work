/**
 * Artifact CRUD — read/write the `artifacts` table.
 */

import { getDb } from './schema.js';

/** Cap stored artifact content (plan Task 4 — align with HTML auto-save). */
export const ARTIFACT_CONTENT_MAX_CHARS = 2 * 1024 * 1024;

function normalizeContent(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const content = typeof raw === 'string' ? raw : String(raw);
  if (/\0/.test(content)) {
    throw new Error('content contains invalid control characters');
  }
  if (content.length > ARTIFACT_CONTENT_MAX_CHARS) {
    throw new Error(`content exceeds max size (${ARTIFACT_CONTENT_MAX_CHARS} characters)`);
  }
  return content;
}

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

function hasUnsafeNameChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

/** Cap id-like fields (workflowId / runId / artifact id — UUID/nanoid practical bound). */
export const ARTIFACT_ID_FIELD_MAX = 100;
/** Cap nodeId (align with GRAPH_ID_MAX_CHARS). */
export const ARTIFACT_NODE_ID_MAX = 200;
/** Cap stored file_path length. */
export const ARTIFACT_FILE_PATH_MAX = 1_000;

/** Optional association ids: invalid → null (do not fail create). */
function normalizeIdField(raw: unknown, max = ARTIFACT_ID_FIELD_MAX): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > max || hasUnsafeNameChars(s)) return null;
  return s;
}

/** Lookup/path ids: invalid → empty (no-op / not found). */
function normalizeLookupId(raw: unknown, max = ARTIFACT_ID_FIELD_MAX): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > max || hasUnsafeNameChars(s)) return '';
  return s;
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
  if (hasUnsafeNameChars(name) || hasUnsafeNameChars(workflowId)) {
    throw new Error('name/workflowId contains invalid control characters');
  }
  if (workflowId.length > ARTIFACT_ID_FIELD_MAX) {
    throw new Error(`workflowId exceeds max length (${ARTIFACT_ID_FIELD_MAX})`);
  }
  if (name.length > 500) {
    throw new Error('name exceeds max length (500)');
  }
  // MIME type hygiene: no control chars; must look like type/subtype (optional params stripped)
  if (hasUnsafeNameChars(contentType) || contentType.length > 200) {
    throw new Error('contentType is invalid');
  }
  const mimeBase = contentType.split(';')[0]?.trim() ?? '';
  if (!mimeBase || !mimeBase.includes('/') || mimeBase.startsWith('/') || mimeBase.endsWith('/')) {
    throw new Error('contentType is invalid');
  }
  const runId = normalizeIdField(input.runId);
  const nodeId = normalizeIdField(input.nodeId, ARTIFACT_NODE_ID_MAX);
  const filePath =
    typeof input.filePath === 'string' ? input.filePath.trim() || null : null;
  if (filePath && (hasUnsafeNameChars(filePath) || filePath.length > ARTIFACT_FILE_PATH_MAX)) {
    throw new Error('filePath is invalid');
  }
  const content = normalizeContent(input.content);
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO artifacts (id, workflow_id, run_id, name, content_type, content, file_path, node_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, runId, name, contentType, content, filePath, nodeId);
  return getArtifact(id)!;
}

export function getArtifact(id: string): Artifact | undefined {
  const trimmed = normalizeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(trimmed) as ArtifactRow | undefined;
  return row ? rowToArtifact(row) : undefined;
}

export function listArtifacts(workflowId: string): Artifact[] {
  const trimmed = normalizeLookupId(workflowId);
  if (!trimmed) return [];
  const db = getDb();
  const rows = db.prepare('SELECT * FROM artifacts WHERE workflow_id = ? ORDER BY created_at DESC').all(trimmed) as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function listArtifactsByRun(runId: string): Artifact[] {
  const trimmed = normalizeLookupId(runId);
  if (!trimmed) return [];
  const db = getDb();
  const rows = db.prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at DESC').all(trimmed) as ArtifactRow[];
  return rows.map(rowToArtifact);
}

export function deleteArtifact(id: string): boolean {
  const trimmed = normalizeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM artifacts WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function updateArtifactContent(id: string, content: string): Artifact | undefined {
  const trimmed = normalizeLookupId(id);
  if (!trimmed) return undefined;
  const body = normalizeContent(content);
  const db = getDb();
  db.prepare(`UPDATE artifacts SET content = ?, updated_at = datetime('now') WHERE id = ?`).run(body, trimmed);
  return getArtifact(trimmed);
}

/** Plan Task 4 — PATCH name and/or content. */
export function updateArtifact(
  id: string,
  input: { name?: string; content?: string },
): Artifact | undefined {
  const trimmed = normalizeLookupId(id);
  if (!trimmed) return undefined;
  const existing = getArtifact(trimmed);
  if (!existing) return undefined;
  const db = getDb();
  const name =
    input.name !== undefined
      ? (typeof input.name === 'string' ? input.name.trim() : '')
      : existing.name;
  if (!name) return undefined;
  if (hasUnsafeNameChars(name) || name.length > 500) return undefined;
  const content =
    input.content !== undefined
      ? normalizeContent(input.content)
      : (existing.content ?? null);
  db.prepare(
    `UPDATE artifacts SET name = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(name, content, trimmed);
  return getArtifact(trimmed);
}
