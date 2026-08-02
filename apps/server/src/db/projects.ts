/**
 * Design Project CRUD + file_revisions + preview_comments (v0.5.0 M1).
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  CreateDesignProjectInput,
  DesignProject,
  FileRevision,
  FileRevisionSource,
  PreviewComment,
  ProjectConversation,
  ProjectMessage,
  UpdateDesignProjectInput,
} from '@neos-work/shared';
import { getDb } from './schema.js';
import {
  defaultProjectsRoot,
  PathSandboxError,
  normalizeProjectRelativePath,
  validateImportBaseDir,
  defaultDataDir,
} from '../lib/path-sandbox.js';
import { detectEntryFile, contentHash } from '../lib/project-files.js';

const LOOKUP_ID_MAX = 100;
export const PROJECT_NAME_MAX = 200;
export const FILE_REVISION_MAX_PER_PATH = 50;
export const FILE_REVISION_CONTENT_MAX = 2 * 1024 * 1024;
export const PREVIEW_COMMENT_BODY_MAX = 8_000;
/** Align with project-archive entryFile cap. */
const ENTRY_FILE_MAX = 500;

/**
 * Normalize entry file to a project-relative path (no `..`, absolute, controls).
 * Returns null when raw is empty after trim; throws on invalid.
 */
function normalizeEntryFile(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string' || hasControl(raw)) {
    throw new Error('Invalid entryFile');
  }
  const trimmed = raw.trim().replace(/^\/+/, '');
  if (!trimmed) return null;
  if (trimmed.length > ENTRY_FILE_MAX) {
    throw new Error('Invalid entryFile');
  }
  try {
    return normalizeProjectRelativePath(trimmed);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      throw new Error('Invalid entryFile');
    }
    throw err;
  }
}

interface ProjectRow {
  id: string;
  name: string;
  base_dir: string;
  entry_file: string | null;
  design_system_id: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
}

interface FileRevisionRow {
  id: string;
  project_id: string;
  path: string;
  content_hash: string;
  content: string | null;
  source: string;
  created_at: string;
}

interface PreviewCommentRow {
  id: string;
  project_id: string;
  file_path: string;
  selector: string;
  body: string;
  created_at: string;
  updated_at: string | null;
}

interface ConversationRow {
  id: string;
  project_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  agent_id: string | null;
  created_at: string;
}

function hasControl(s: string): boolean {
  return /[\0\r\n]/.test(s);
}

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX): string {
  if (typeof raw !== 'string' || hasControl(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function rowToProject(row: ProjectRow): DesignProject {
  return {
    id: row.id,
    name: row.name,
    baseDir: row.base_dir,
    entryFile: row.entry_file,
    designSystemId: row.design_system_id,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string' || hasControl(raw)) {
    throw new Error('Invalid name');
  }
  const name = raw.trim();
  if (!name || name.length > PROJECT_NAME_MAX) {
    throw new Error('Invalid name');
  }
  return name;
}

function ensureDefaultWorkspace(projectId: string): string {
  const root = defaultProjectsRoot();
  const dir = path.join(root, projectId);
  // Refuse planted projects root symlink (mkdir would follow outside)
  try {
    const st = fs.lstatSync(root);
    if (st.isSymbolicLink()) {
      throw new Error('Invalid project workspace path');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid project workspace path') throw err;
    // ENOENT — create below
  }
  // Refuse planted workspace path that is a symlink (escape outside projects root)
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) {
      throw new Error('Invalid project workspace path');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid project workspace path') throw err;
    // ENOENT — create below
  }
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  let realRoot: string;
  let realDir: string;
  try {
    realRoot = fs.realpathSync(root);
    realDir = fs.realpathSync(dir);
  } catch {
    throw new Error('Invalid project workspace path');
  }
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realDir !== realRoot && !realDir.startsWith(prefix)) {
    throw new Error('Invalid project workspace path');
  }
  return realDir;
}

export function listProjects(): DesignProject[] {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, name, base_dir, entry_file, design_system_id, meta_json, created_at, updated_at FROM projects ORDER BY updated_at DESC',
    )
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): DesignProject | undefined {
  const pid = safeLookupId(id);
  if (!pid) return undefined;
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, name, base_dir, entry_file, design_system_id, meta_json, created_at, updated_at FROM projects WHERE id = ?',
    )
    .get(pid) as ProjectRow | undefined;
  return row ? rowToProject(row) : undefined;
}

export function createProject(input: CreateDesignProjectInput): DesignProject {
  const name = normalizeName(input.name);
  const id = crypto.randomUUID();

  let baseDir: string;
  if (input.baseDir != null && String(input.baseDir).trim()) {
    baseDir = validateImportBaseDir(String(input.baseDir), {
      dataDir: defaultDataDir(),
      requireExists: true,
    });
  } else {
    baseDir = ensureDefaultWorkspace(id);
  }

  let entryFile: string | null =
    input.entryFile !== undefined && input.entryFile !== null
      ? normalizeEntryFile(input.entryFile)
      : null;
  if (entryFile === null) {
    entryFile = detectEntryFile(baseDir);
  }

  const designSystemId =
    typeof input.designSystemId === 'string' && !hasControl(input.designSystemId)
      ? input.designSystemId.trim() || null
      : null;

  const meta =
    input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
      ? input.meta
      : {};
  const metaJson = JSON.stringify(meta);

  // Seed empty index.html if workspace empty and no entry
  try {
    const entries = fs.readdirSync(baseDir);
    if (entries.length === 0) {
      const safeTitle = name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const seed = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>Generated by NEOS Work Design Project.</p>
  </main>
</body>
</html>
`;
      fs.writeFileSync(path.join(baseDir, 'index.html'), seed, 'utf8');
      entryFile = entryFile ?? 'index.html';
    }
  } catch {
    // ignore seed errors
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO projects (id, name, base_dir, entry_file, design_system_id, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, baseDir, entryFile, designSystemId, metaJson);

  const created = getProject(id);
  if (!created) throw new Error('Failed to create project');
  return created;
}

export function updateProject(
  id: string,
  input: UpdateDesignProjectInput,
): DesignProject | undefined {
  const existing = getProject(id);
  if (!existing) return undefined;

  const name =
    input.name !== undefined ? normalizeName(input.name) : existing.name;

  let baseDir = existing.baseDir;
  if (input.baseDir != null && String(input.baseDir).trim()) {
    baseDir = validateImportBaseDir(String(input.baseDir), {
      dataDir: defaultDataDir(),
      requireExists: true,
    });
  }

  let entryFile = existing.entryFile;
  if (input.entryFile !== undefined) {
    if (input.entryFile === null) {
      entryFile = null;
    } else {
      entryFile = normalizeEntryFile(input.entryFile);
    }
  } else if (baseDir !== existing.baseDir) {
    entryFile = detectEntryFile(baseDir);
  }

  let designSystemId = existing.designSystemId;
  if (input.designSystemId !== undefined) {
    if (input.designSystemId === null) {
      designSystemId = null;
    } else if (
      typeof input.designSystemId === 'string' &&
      !hasControl(input.designSystemId)
    ) {
      designSystemId = input.designSystemId.trim() || null;
    } else {
      throw new Error('Invalid designSystemId');
    }
  }

  const meta =
    input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
      ? input.meta
      : existing.meta;

  const db = getDb();
  db.prepare(
    `UPDATE projects
     SET name = ?, base_dir = ?, entry_file = ?, design_system_id = ?, meta_json = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, baseDir, entryFile, designSystemId, JSON.stringify(meta), existing.id);

  return getProject(existing.id);
}

export function deleteProject(id: string): boolean {
  const pid = safeLookupId(id);
  if (!pid) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
  return result.changes > 0;
}

// ── File revisions ─────────────────────────────────────────

const REVISION_SOURCES = new Set<FileRevisionSource>([
  'user',
  'agent',
  'import',
  'restore',
]);

function rowToRevision(row: FileRevisionRow, includeContent: boolean): FileRevision {
  const source = REVISION_SOURCES.has(row.source as FileRevisionSource)
    ? (row.source as FileRevisionSource)
    : 'user';
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    contentHash: row.content_hash,
    content: includeContent ? (row.content ?? undefined) : undefined,
    source,
    createdAt: row.created_at,
  };
}

/**
 * Normalize a project-relative file path for DB storage/lookup.
 * Rejects `..`, absolute, controls (same rules as entryFile / path sandbox).
 */
function normalizeStoredRelPath(raw: unknown, label = 'path'): string {
  try {
    const p = normalizeEntryFile(raw);
    if (!p) throw new Error(`Invalid ${label}`);
    return p;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function tryNormalizeStoredRelPath(raw: unknown): string | null {
  try {
    return normalizeEntryFile(raw);
  } catch {
    return null;
  }
}

export function recordFileRevision(input: {
  projectId: string;
  path: string;
  content: string;
  source: FileRevisionSource;
}): FileRevision {
  const projectId = safeLookupId(input.projectId);
  if (!projectId) throw new Error('Invalid projectId');
  const relPath = normalizeStoredRelPath(input.path, 'path');
  if (typeof input.content !== 'string' || /\0/.test(input.content)) {
    throw new Error('Invalid content');
  }
  if (input.content.length > FILE_REVISION_CONTENT_MAX) {
    throw new Error(`revision content exceeds max size (${FILE_REVISION_CONTENT_MAX})`);
  }
  const source = input.source;
  if (!['user', 'agent', 'import', 'restore'].includes(source)) {
    throw new Error('Invalid source');
  }

  const id = crypto.randomUUID();
  const hash = contentHash(input.content);
  const db = getDb();
  db.prepare(
    `INSERT INTO file_revisions (id, project_id, path, content_hash, content, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, relPath, hash, input.content, source);

  // Cap per path (rowid breaks ties when created_at shares second precision)
  const overflow = db
    .prepare(
      `SELECT id FROM file_revisions
       WHERE project_id = ? AND path = ?
       ORDER BY rowid DESC
       LIMIT -1 OFFSET ?`,
    )
    .all(projectId, relPath, FILE_REVISION_MAX_PER_PATH) as Array<{ id: string }>;
  if (overflow.length > 0) {
    const del = db.prepare('DELETE FROM file_revisions WHERE id = ?');
    for (const r of overflow) del.run(r.id);
  }

  const row = db
    .prepare(
      'SELECT id, project_id, path, content_hash, content, source, created_at FROM file_revisions WHERE id = ?',
    )
    .get(id) as FileRevisionRow | undefined;
  if (!row) {
    throw new Error('Failed to record file revision');
  }
  return rowToRevision(row, true);
}

export function listFileRevisions(
  projectId: string,
  filePath?: string,
): Omit<FileRevision, 'content'>[] {
  const pid = safeLookupId(projectId);
  if (!pid) return [];
  const db = getDb();
  if (filePath) {
    const rel = tryNormalizeStoredRelPath(filePath);
    if (!rel) return [];
    const rows = db
      .prepare(
        `SELECT id, project_id, path, content_hash, content, source, created_at
         FROM file_revisions WHERE project_id = ? AND path = ?
         ORDER BY rowid DESC`,
      )
      .all(pid, rel) as FileRevisionRow[];
    return rows.map((r) => rowToRevision(r, false));
  }
  const rows = db
    .prepare(
      `SELECT id, project_id, path, content_hash, content, source, created_at
       FROM file_revisions WHERE project_id = ?
       ORDER BY rowid DESC LIMIT 200`,
    )
    .all(pid) as FileRevisionRow[];
  return rows.map((r) => rowToRevision(r, false));
}

export function getFileRevision(id: string): FileRevision | undefined {
  const rid = safeLookupId(id);
  if (!rid) return undefined;
  const db = getDb();
  const row = db
    .prepare(
      'SELECT id, project_id, path, content_hash, content, source, created_at FROM file_revisions WHERE id = ?',
    )
    .get(rid) as FileRevisionRow | undefined;
  return row ? rowToRevision(row, true) : undefined;
}

// ── Preview comments ───────────────────────────────────────

function rowToComment(row: PreviewCommentRow): PreviewComment {
  return {
    id: row.id,
    projectId: row.project_id,
    filePath: row.file_path,
    selector: row.selector,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function listPreviewComments(projectId: string, filePath?: string): PreviewComment[] {
  const pid = safeLookupId(projectId);
  if (!pid) return [];
  const db = getDb();
  if (filePath) {
    const rel = tryNormalizeStoredRelPath(filePath);
    if (!rel) return [];
    const rows = db
      .prepare(
        `SELECT id, project_id, file_path, selector, body, created_at, updated_at
         FROM preview_comments WHERE project_id = ? AND file_path = ?
         ORDER BY created_at ASC`,
      )
      .all(pid, rel) as PreviewCommentRow[];
    return rows.map(rowToComment);
  }
  const rows = db
    .prepare(
      `SELECT id, project_id, file_path, selector, body, created_at, updated_at
       FROM preview_comments WHERE project_id = ?
       ORDER BY created_at ASC`,
    )
    .all(pid) as PreviewCommentRow[];
  return rows.map(rowToComment);
}

export function createPreviewComment(input: {
  projectId: string;
  filePath: string;
  selector: string;
  body: string;
}): PreviewComment {
  const projectId = safeLookupId(input.projectId);
  if (!projectId) throw new Error('Invalid projectId');
  const filePath = normalizeStoredRelPath(input.filePath, 'filePath');
  if (typeof input.selector !== 'string' || hasControl(input.selector) || !input.selector.trim()) {
    throw new Error('Invalid selector');
  }
  if (typeof input.body !== 'string' || hasControl(input.body) || !input.body.trim()) {
    throw new Error('Invalid body');
  }
  if (input.body.length > PREVIEW_COMMENT_BODY_MAX) {
    throw new Error('body exceeds max length');
  }
  const id = crypto.randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO preview_comments (id, project_id, file_path, selector, body)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, filePath, input.selector.trim(), input.body.trim());
  const row = db
    .prepare(
      'SELECT id, project_id, file_path, selector, body, created_at, updated_at FROM preview_comments WHERE id = ?',
    )
    .get(id) as PreviewCommentRow;
  return rowToComment(row);
}

export function deletePreviewComment(id: string): boolean {
  const cid = safeLookupId(id);
  if (!cid) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM preview_comments WHERE id = ?').run(cid);
  return result.changes > 0;
}

// ── Conversations / messages (minimal for M1 shell) ────────

function rowToConversation(row: ConversationRow): ProjectConversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): ProjectMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ProjectMessage['role'],
    content: row.content,
    agentId: row.agent_id,
    createdAt: row.created_at,
  };
}

export function createConversation(
  projectId: string,
  title?: string | null,
): ProjectConversation {
  const pid = safeLookupId(projectId);
  if (!pid) throw new Error('Invalid projectId');
  if (!getProject(pid)) throw new PathSandboxError('project not found', 'not_found');
  const id = crypto.randomUUID();
  let t: string | null = null;
  if (typeof title === 'string' && !hasControl(title)) {
    t = title.trim().slice(0, 200) || null;
  }
  const db = getDb();
  db.prepare(
    'INSERT INTO project_conversations (id, project_id, title) VALUES (?, ?, ?)',
  ).run(id, pid, t);
  const row = db
    .prepare(
      'SELECT id, project_id, title, created_at, updated_at FROM project_conversations WHERE id = ?',
    )
    .get(id) as ConversationRow;
  return rowToConversation(row);
}

export function listConversations(projectId: string): ProjectConversation[] {
  const pid = safeLookupId(projectId);
  if (!pid) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, project_id, title, created_at, updated_at
       FROM project_conversations WHERE project_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(pid) as ConversationRow[];
  return rows.map(rowToConversation);
}

export function addMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string | null;
}): ProjectMessage {
  const cid = safeLookupId(input.conversationId);
  if (!cid) throw new Error('Invalid conversationId');
  if (!['user', 'assistant', 'system'].includes(input.role)) {
    throw new Error('Invalid role');
  }
  if (typeof input.content !== 'string' || /\0/.test(input.content)) {
    throw new Error('Invalid content');
  }
  if (!input.content.trim()) throw new Error('content is required');
  if (input.content.length > 512 * 1024) throw new Error('content too large');

  const id = crypto.randomUUID();
  const agentId =
    typeof input.agentId === 'string' && !hasControl(input.agentId)
      ? input.agentId.trim() || null
      : null;
  const db = getDb();
  db.prepare(
    `INSERT INTO project_messages (id, conversation_id, role, content, agent_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, cid, input.role, input.content, agentId);
  db.prepare(
    `UPDATE project_conversations SET updated_at = datetime('now') WHERE id = ?`,
  ).run(cid);
  const row = db
    .prepare(
      'SELECT id, conversation_id, role, content, agent_id, created_at FROM project_messages WHERE id = ?',
    )
    .get(id) as MessageRow;
  return rowToMessage(row);
}

export function listMessages(conversationId: string): ProjectMessage[] {
  const cid = safeLookupId(conversationId);
  if (!cid) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, agent_id, created_at
       FROM project_messages WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(cid) as MessageRow[];
  return rows.map(rowToMessage);
}
