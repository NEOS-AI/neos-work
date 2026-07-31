/**
 * Live Artifact CRUD + refresh history (PLAN_FOR_V0_5_0 Task 9).
 * Project-scoped; optional file sidecar under project baseDir.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './schema.js';
import { getProject } from './projects.js';
import { contentHash, writeProjectFile } from '../lib/project-files.js';
import { resolveUnderRoot } from '../lib/path-sandbox.js';

const LOOKUP_ID_MAX = 100;
const NAME_MAX = 200;
const TEMPLATE_MAX = 2 * 1024 * 1024;
const CONTENT_MAX = 2 * 1024 * 1024;
const INPUTS_JSON_MAX = 256 * 1024;
const REFRESH_HISTORY_MAX = 50;

export interface LiveArtifact {
  id: string;
  projectId: string;
  name: string;
  sourceTemplate: string | null;
  inputs: Record<string, unknown>;
  content: string | null;
  contentType: string;
  sidecarPath: string | null;
  refreshCount: number;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveArtifactRefresh {
  id: string;
  artifactId: string;
  status: 'succeeded' | 'failed';
  contentHash: string | null;
  error: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  project_id: string;
  name: string;
  source_template: string | null;
  inputs_json: string | null;
  content: string | null;
  content_type: string;
  sidecar_path: string | null;
  refresh_count: number;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RefreshRow {
  id: string;
  artifact_id: string;
  status: string;
  content_hash: string | null;
  error: string | null;
  created_at: string;
}

function hasControl(s: string): boolean {
  return /[\0\r\n]/.test(s);
}

function safeId(raw: unknown): string {
  if (typeof raw !== 'string' || hasControl(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > LOOKUP_ID_MAX) return '';
  return s;
}

function safeName(raw: unknown): string {
  if (typeof raw !== 'string' || hasControl(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > NAME_MAX) return '';
  return s;
}

function parseInputs(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function serializeInputs(inputs: Record<string, unknown> | undefined): string {
  const obj = inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? inputs : {};
  // Drop keys with control chars
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k !== 'string' || hasControl(k) || !k.trim()) continue;
    clean[k.trim().slice(0, 100)] = v;
  }
  const json = JSON.stringify(clean);
  if (json.length > INPUTS_JSON_MAX) {
    throw new Error(`inputs exceed max size (${INPUTS_JSON_MAX} characters)`);
  }
  return json;
}

function rowToArtifact(row: Row): LiveArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceTemplate: row.source_template,
    inputs: parseInputs(row.inputs_json),
    content: row.content,
    contentType: row.content_type || 'text/html',
    sidecarPath: row.sidecar_path,
    refreshCount: Number(row.refresh_count) || 0,
    lastRefreshedAt: row.last_refreshed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRefresh(row: RefreshRow): LiveArtifactRefresh {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    status: row.status === 'failed' ? 'failed' : 'succeeded',
    contentHash: row.content_hash,
    error: row.error,
    createdAt: row.created_at,
  };
}

/** Simple {{key}} substitution for templates. */
export function renderLiveTemplate(
  template: string,
  inputs: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in inputs)) return '';
    const v = inputs[key];
    if (v == null) return '';
    if (typeof v === 'string') {
      // prevent null-byte injection into rendered HTML
      return v.replace(/\0/g, '');
    }
    try {
      return JSON.stringify(v).replace(/\0/g, '');
    } catch {
      return String(v);
    }
  });
}

export function listLiveArtifacts(projectId: string): LiveArtifact[] {
  const pid = safeId(projectId);
  if (!pid) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM live_artifacts WHERE project_id = ? ORDER BY updated_at DESC`,
    )
    .all(pid) as Row[];
  return rows.map(rowToArtifact);
}

export function getLiveArtifact(id: string, projectId?: string): LiveArtifact | null {
  const aid = safeId(id);
  if (!aid) return null;
  const row = getDb()
    .prepare(`SELECT * FROM live_artifacts WHERE id = ?`)
    .get(aid) as Row | undefined;
  if (!row) return null;
  if (projectId) {
    const pid = safeId(projectId);
    if (!pid || row.project_id !== pid) return null;
  }
  return rowToArtifact(row);
}

export function createLiveArtifact(input: {
  projectId: string;
  name: string;
  sourceTemplate?: string | null;
  inputs?: Record<string, unknown>;
  contentType?: string;
  writeSidecar?: boolean;
}): LiveArtifact {
  const projectId = safeId(input.projectId);
  if (!projectId) throw new Error('Invalid projectId');
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');

  const name = safeName(input.name);
  if (!name) throw new Error('Invalid name');

  let sourceTemplate: string | null = null;
  if (input.sourceTemplate != null) {
    if (typeof input.sourceTemplate !== 'string' || /\0/.test(input.sourceTemplate)) {
      throw new Error('sourceTemplate contains invalid control characters');
    }
    if (input.sourceTemplate.length > TEMPLATE_MAX) {
      throw new Error(`sourceTemplate exceeds max size (${TEMPLATE_MAX} characters)`);
    }
    sourceTemplate = input.sourceTemplate;
  }

  let contentType = 'text/html';
  if (typeof input.contentType === 'string' && !hasControl(input.contentType)) {
    const ct = input.contentType.trim().toLowerCase().slice(0, 100);
    if (ct) contentType = ct;
  }

  const inputsJson = serializeInputs(input.inputs);
  const inputs = parseInputs(inputsJson);
  let content: string | null = null;
  if (sourceTemplate) {
    content = renderLiveTemplate(sourceTemplate, inputs);
    if (content.length > CONTENT_MAX) {
      throw new Error(`rendered content exceeds max size (${CONTENT_MAX} characters)`);
    }
  }

  const id = crypto.randomUUID();
  let sidecarPath: string | null = null;
  if (input.writeSidecar !== false && content != null) {
    sidecarPath = writeSidecarFile(project.baseDir, id, content, contentType);
  }

  getDb()
    .prepare(
      `INSERT INTO live_artifacts (
        id, project_id, name, source_template, inputs_json, content, content_type,
        sidecar_path, refresh_count, last_refreshed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))`,
    )
    .run(
      id,
      projectId,
      name,
      sourceTemplate,
      inputsJson,
      content,
      contentType,
      sidecarPath,
    );

  const created = getLiveArtifact(id);
  if (!created) throw new Error('Failed to create live artifact');
  return created;
}

export function updateLiveArtifact(
  id: string,
  projectId: string,
  patch: {
    name?: string;
    sourceTemplate?: string | null;
    inputs?: Record<string, unknown>;
    contentType?: string;
  },
): LiveArtifact | null {
  const existing = getLiveArtifact(id, projectId);
  if (!existing) return null;

  const name =
    patch.name !== undefined ? safeName(patch.name) : existing.name;
  if (!name) throw new Error('Invalid name');

  let sourceTemplate = existing.sourceTemplate;
  if (patch.sourceTemplate !== undefined) {
    if (patch.sourceTemplate === null) {
      sourceTemplate = null;
    } else if (typeof patch.sourceTemplate !== 'string' || /\0/.test(patch.sourceTemplate)) {
      throw new Error('sourceTemplate contains invalid control characters');
    } else if (patch.sourceTemplate.length > TEMPLATE_MAX) {
      throw new Error(`sourceTemplate exceeds max size (${TEMPLATE_MAX} characters)`);
    } else {
      sourceTemplate = patch.sourceTemplate;
    }
  }

  let inputs = existing.inputs;
  let inputsJson = serializeInputs(existing.inputs);
  if (patch.inputs !== undefined) {
    inputsJson = serializeInputs(patch.inputs);
    inputs = parseInputs(inputsJson);
  }

  let contentType = existing.contentType;
  if (typeof patch.contentType === 'string' && !hasControl(patch.contentType)) {
    const ct = patch.contentType.trim().toLowerCase().slice(0, 100);
    if (ct) contentType = ct;
  }

  // Re-render when template or inputs change
  let content = existing.content;
  if (patch.sourceTemplate !== undefined || patch.inputs !== undefined) {
    if (sourceTemplate) {
      content = renderLiveTemplate(sourceTemplate, inputs);
      if (content.length > CONTENT_MAX) {
        throw new Error(`rendered content exceeds max size (${CONTENT_MAX} characters)`);
      }
    } else {
      content = null;
    }
  }

  const project = getProject(projectId);
  let sidecarPath = existing.sidecarPath;
  if (project && content != null) {
    sidecarPath = writeSidecarFile(project.baseDir, existing.id, content, contentType);
  }

  getDb()
    .prepare(
      `UPDATE live_artifacts SET
        name = ?, source_template = ?, inputs_json = ?, content = ?, content_type = ?,
        sidecar_path = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?`,
    )
    .run(
      name,
      sourceTemplate,
      inputsJson,
      content,
      contentType,
      sidecarPath,
      existing.id,
      projectId,
    );

  return getLiveArtifact(id, projectId);
}

export function deleteLiveArtifact(id: string, projectId: string): boolean {
  const existing = getLiveArtifact(id, projectId);
  if (!existing) return false;
  getDb().prepare(`DELETE FROM live_artifact_refreshes WHERE artifact_id = ?`).run(existing.id);
  const r = getDb()
    .prepare(`DELETE FROM live_artifacts WHERE id = ? AND project_id = ?`)
    .run(existing.id, projectId);
  // best-effort sidecar cleanup — only project-relative sandboxed paths
  // (never unlink absolute/escaped paths even if DB is corrupted)
  if (existing.sidecarPath) {
    try {
      const project = getProject(projectId);
      if (project?.baseDir) {
        const { absolute } = resolveUnderRoot(project.baseDir, existing.sidecarPath, {
          mustExist: true,
        });
        fs.unlinkSync(absolute);
      }
    } catch {
      // PathSandboxError / ENOENT / IO — never throw from cleanup
    }
  }
  return r.changes > 0;
}

export function refreshLiveArtifact(
  id: string,
  projectId: string,
  inputsPatch?: Record<string, unknown>,
): { artifact: LiveArtifact; refresh: LiveArtifactRefresh } {
  const existing = getLiveArtifact(id, projectId);
  if (!existing) throw new Error('Live artifact not found');
  if (!existing.sourceTemplate) {
    throw new Error('sourceTemplate is required to refresh');
  }

  const inputs =
    inputsPatch !== undefined
      ? { ...existing.inputs, ...parseInputs(serializeInputs(inputsPatch)) }
      : existing.inputs;

  const refreshId = crypto.randomUUID();
  try {
    const content = renderLiveTemplate(existing.sourceTemplate, inputs);
    if (content.length > CONTENT_MAX) {
      throw new Error(`rendered content exceeds max size (${CONTENT_MAX} characters)`);
    }
    const hash = contentHash(content);
    const project = getProject(projectId);
    let sidecarPath = existing.sidecarPath;
    if (project) {
      sidecarPath = writeSidecarFile(
        project.baseDir,
        existing.id,
        content,
        existing.contentType,
      );
    }

    getDb()
      .prepare(
        `UPDATE live_artifacts SET
          inputs_json = ?, content = ?, sidecar_path = ?,
          refresh_count = refresh_count + 1,
          last_refreshed_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ? AND project_id = ?`,
      )
      .run(serializeInputs(inputs), content, sidecarPath, existing.id, projectId);

    getDb()
      .prepare(
        `INSERT INTO live_artifact_refreshes (id, artifact_id, status, content_hash, error, created_at)
         VALUES (?, ?, 'succeeded', ?, NULL, datetime('now'))`,
      )
      .run(refreshId, existing.id, hash);

    trimRefreshHistory(existing.id);

    const artifact = getLiveArtifact(id, projectId)!;
    const refresh = listLiveArtifactRefreshes(existing.id, 1)[0]!;
    return { artifact, refresh };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Refresh failed';
    getDb()
      .prepare(
        `INSERT INTO live_artifact_refreshes (id, artifact_id, status, content_hash, error, created_at)
         VALUES (?, ?, 'failed', NULL, ?, datetime('now'))`,
      )
      .run(refreshId, existing.id, msg.slice(0, 500));
    trimRefreshHistory(existing.id);
    throw err;
  }
}

export function listLiveArtifactRefreshes(
  artifactId: string,
  limit = 20,
): LiveArtifactRefresh[] {
  const aid = safeId(artifactId);
  if (!aid) return [];
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = getDb()
    .prepare(
      `SELECT * FROM live_artifact_refreshes WHERE artifact_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(aid, capped) as RefreshRow[];
  return rows.map(rowToRefresh);
}

function trimRefreshHistory(artifactId: string): void {
  const rows = getDb()
    .prepare(
      `SELECT id FROM live_artifact_refreshes WHERE artifact_id = ?
       ORDER BY created_at DESC`,
    )
    .all(artifactId) as Array<{ id: string }>;
  if (rows.length <= REFRESH_HISTORY_MAX) return;
  const drop = rows.slice(REFRESH_HISTORY_MAX).map((r) => r.id);
  const del = getDb().prepare(`DELETE FROM live_artifact_refreshes WHERE id = ?`);
  for (const id of drop) del.run(id);
}

function writeSidecarFile(
  baseDir: string,
  artifactId: string,
  content: string,
  contentType: string,
): string {
  const ext =
    contentType.includes('markdown') ? 'md'
      : contentType.includes('json') ? 'json'
        : contentType.includes('svg') ? 'svg'
          : 'html';
  const rel = `.neos-work/live-artifacts/${artifactId}.${ext}`;
  writeProjectFile(baseDir, rel, content, { mkdir: true });
  return rel;
}
