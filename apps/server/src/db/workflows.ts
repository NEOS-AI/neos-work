/**
 * Workflow CRUD operations (SQLite).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from './schema.js';
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  NodeRunResult,
} from '@neos-work/shared';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  nodes_json: string;
  edges_json: string;
  webhook_secret: string | null;
  design_system_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  status: string;
  node_results_json: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

function safeParseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function safeParseJsonObject<T extends Record<string, unknown>>(
  raw: string,
  fallback: T,
): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    domain: row.domain as Workflow['domain'],
    nodes: safeParseJsonArray<WorkflowNode>(row.nodes_json),
    edges: safeParseJsonArray<WorkflowEdge>(row.edges_json),
    webhookSecret: row.webhook_secret ?? undefined,
    designSystemId: row.design_system_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRun['status'],
    nodeResults: safeParseJsonObject<Record<string, NodeRunResult>>(
      row.node_results_json,
      {},
    ),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

/** Practical bound for workflow / run ids (align with session safeLookupId). */
const LOOKUP_ID_MAX_CHARS = 100;

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

export function listWorkflows(): Workflow[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflow ORDER BY updated_at DESC')
    .all() as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function getWorkflow(id: string): Workflow | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow WHERE id = ?').get(trimmed) as WorkflowRow | undefined;
  return row ? rowToWorkflow(row) : undefined;
}

function normalizeWorkflowDomain(raw: unknown): Workflow['domain'] {
  // Control-char domain → general (check before trim)
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'general';
  const domainRaw = raw.trim().toLowerCase() || 'general';
  return (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as Workflow['domain'])
    : 'general';
}

/** Cap workflow name / description (UI + DB hygiene). */
export const WORKFLOW_NAME_MAX_CHARS = 200;
export const WORKFLOW_DESCRIPTION_MAX_CHARS = 4_000;
/** Cap serialized graph size (nodes+edges JSON) — runaway paste defense. */
export const WORKFLOW_GRAPH_JSON_MAX_CHARS = 5 * 1024 * 1024;

export function createWorkflow(input: {
  name: string;
  description?: string;
  domain: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Workflow {
  const nameRaw = typeof input.name === 'string' ? input.name : '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(nameRaw)) {
    throw new Error('name contains invalid control characters');
  }
  const name = nameRaw.trim();
  if (!name) {
    throw new Error('name is required');
  }
  if (name.length > WORKFLOW_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${WORKFLOW_NAME_MAX_CHARS})`);
  }
  let description: string | null = null;
  if (input.description !== undefined) {
    if (typeof input.description === 'string') {
      // Multi-line descriptions are allowed; reject null bytes only
      if (/\0/.test(input.description)) {
        throw new Error('description contains invalid control characters');
      }
      description = input.description.trim() || null;
    }
  }
  if (description && description.length > WORKFLOW_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, WORKFLOW_DESCRIPTION_MAX_CHARS);
  }
  const domain = normalizeWorkflowDomain(input.domain);
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const nodesJson = JSON.stringify(nodes);
  const edgesJson = JSON.stringify(edges);
  if (nodesJson.length + edgesJson.length > WORKFLOW_GRAPH_JSON_MAX_CHARS) {
    throw new Error(
      `workflow graph exceeds max size (${WORKFLOW_GRAPH_JSON_MAX_CHARS} characters)`,
    );
  }
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO workflow (id, name, description, domain, nodes_json, edges_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    description,
    domain,
    nodesJson,
    edgesJson,
  );
  return getWorkflow(id)!;
}

export function updateWorkflow(
  id: string,
  input: {
    name?: string;
    description?: string;
    designSystemId?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
  },
): Workflow | undefined {
  const trimmed = safeLookupId(id);
  if (!trimmed) return undefined;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM workflow WHERE id = ?').get(trimmed) as WorkflowRow | undefined;
  if (!existing) return undefined;

  let name = existing.name;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name)) {
      // Invalid rename leaves row unchanged
      return undefined;
    }
    name = input.name.trim() || existing.name;
  }
  if (name.length > WORKFLOW_NAME_MAX_CHARS) {
    return undefined;
  }
  let description = existing.description;
  if (input.description !== undefined) {
    if (typeof input.description === 'string') {
      // Multi-line descriptions allowed; null bytes only
      if (/\0/.test(input.description)) return undefined;
      description = input.description.trim() || null;
    } else {
      description = null;
    }
  }
  if (description && description.length > WORKFLOW_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, WORKFLOW_DESCRIPTION_MAX_CHARS);
  }
  let designSystemId: string | null = existing.design_system_id;
  if (input.designSystemId !== undefined) {
    const rawDs =
      typeof input.designSystemId === 'string'
        ? input.designSystemId
        : (input.designSystemId ?? '').toString();
    // Control-char check before trim (trim would strip leading/trailing \r\n)
    if (/[\0\r\n]/.test(rawDs)) return undefined;
    designSystemId = rawDs.trim() || null;
    if (designSystemId && designSystemId.length > 64) return undefined;
  }
  const nodes =
    input.nodes !== undefined
      ? JSON.stringify(Array.isArray(input.nodes) ? input.nodes : [])
      : existing.nodes_json;
  const edges =
    input.edges !== undefined
      ? JSON.stringify(Array.isArray(input.edges) ? input.edges : [])
      : existing.edges_json;
  if (nodes.length + edges.length > WORKFLOW_GRAPH_JSON_MAX_CHARS) {
    return undefined;
  }

  db.prepare(
    `UPDATE workflow SET name = ?, description = ?, design_system_id = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, description, designSystemId, nodes, edges, trimmed);

  return getWorkflow(trimmed);
}

export function deleteWorkflow(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function duplicateWorkflow(id: string): Workflow | undefined {
  const src = getWorkflow(id);
  if (!src) return undefined;
  const copy = createWorkflow({
    name: `${src.name} (copy)`,
    description: src.description,
    domain: src.domain,
    nodes: src.nodes,
    edges: src.edges,
  });
  // Preserve design context binding (plan Task 1)
  if (src.designSystemId) {
    return updateWorkflow(copy.id, { designSystemId: src.designSystemId }) ?? copy;
  }
  return copy;
}

// ── Workflow Runs ──────────────────────────────────────────

const RUN_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);

/** Cap workflow run error strings stored in SQLite. */
export const WORKFLOW_RUN_ERROR_MAX_CHARS = 4_000;
/** Cap serialized node_results_json (runaway output defense). */
export const WORKFLOW_RUN_RESULTS_MAX_CHARS = 1_048_576;

export function saveRun(run: WorkflowRun): void {
  const id = safeLookupId(run.id);
  const workflowId = safeLookupId(run.workflowId);
  if (!id || !workflowId) {
    throw new Error('saveRun requires non-blank id and workflowId');
  }
  // Control-char status → running fallback (check before trim)
  const statusRaw =
    typeof run.status === 'string' && !/[\0\r\n]/.test(run.status)
      ? run.status.trim().toLowerCase()
      : '';
  const status = RUN_STATUSES.has(statusRaw) ? statusRaw : 'running';
  // Scrub control chars from error text before trim (align with routine-run / agent-steps)
  let error: string | null = null;
  if (typeof run.error === 'string') {
    error = run.error.replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim() || null;
  } else if (run.error != null) {
    error = String(run.error).replace(/[\r\n]+/g, ' ').trim() || null;
  }
  if (error && error.length > WORKFLOW_RUN_ERROR_MAX_CHARS) {
    error = error.slice(0, WORKFLOW_RUN_ERROR_MAX_CHARS);
  }
  const db = getDb();
  const nodeResultsStr = JSON.stringify(run.nodeResults ?? {});
  // Enforce size limit on stored results
  const truncated = nodeResultsStr.length > WORKFLOW_RUN_RESULTS_MAX_CHARS;
  const stored = truncated ? '{"truncated":true}' : nodeResultsStr;

  db.prepare(
    `INSERT INTO workflow_run (id, workflow_id, status, node_results_json, started_at, completed_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       node_results_json = excluded.node_results_json,
       completed_at = excluded.completed_at,
       error = excluded.error`,
  ).run(
    id,
    workflowId,
    status,
    stored,
    run.startedAt,
    run.completedAt ?? null,
    error,
  );
}

export function getRun(runId: string): WorkflowRun | undefined {
  const trimmed = safeLookupId(runId);
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workflow_run WHERE id = ?')
    .get(trimmed) as WorkflowRunRow | undefined;
  return row ? rowToRun(row) : undefined;
}

export function listRuns(workflowId: string, limit = 20, offset = 0): WorkflowRun[] {
  const trimmed = safeLookupId(workflowId);
  if (!trimmed) return [];
  const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const cappedOffset = Math.max(Number(offset) || 0, 0);
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflow_run WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?')
    .all(trimmed, cappedLimit, cappedOffset) as WorkflowRunRow[];
  return rows.map(rowToRun);
}

export function deleteRun(runId: string): boolean {
  const trimmed = safeLookupId(runId);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow_run WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

/**
 * Delete runs for a workflow. Optional status filter (completed|failed|cancelled|running).
 * Returns number of deleted rows.
 */
export function deleteRuns(workflowId: string, status?: string): number {
  const trimmed = safeLookupId(workflowId);
  if (!trimmed) return 0;
  // Control-char status filter → no-op (check before trim)
  const statusRaw =
    typeof status === 'string' && !/[\0\r\n]/.test(status)
      ? status.trim().toLowerCase() || undefined
      : undefined;
  // Only known statuses filter; unknown → no-op delete (safer than matching nothing silently misleads)
  const statusFilter = statusRaw && RUN_STATUSES.has(statusRaw) ? statusRaw : undefined;
  const db = getDb();
  if (status) {
    if (!statusFilter) return 0;
    const result = db
      .prepare('DELETE FROM workflow_run WHERE workflow_id = ? AND status = ?')
      .run(trimmed, statusFilter);
    return result.changes;
  }
  const result = db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(trimmed);
  return result.changes;
}

// ── Webhook ────────────────────────────────────────────────

export function getOrCreateWebhookSecret(workflowId: string): string {
  const trimmed = safeLookupId(workflowId);
  if (!trimmed) throw new Error('Workflow not found');
  const db = getDb();
  const row = db.prepare('SELECT webhook_secret FROM workflow WHERE id = ?').get(trimmed) as { webhook_secret: string | null } | undefined;
  if (!row) throw new Error('Workflow not found');

  if (row.webhook_secret) return row.webhook_secret;

  const secret = randomBytes(32).toString('hex');
  db.prepare("UPDATE workflow SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ?").run(secret, trimmed);
  return secret;
}

export function regenerateWebhookSecret(workflowId: string): string {
  const trimmed = safeLookupId(workflowId);
  if (!trimmed) throw new Error('Workflow not found');
  const db = getDb();
  const secret = randomBytes(32).toString('hex');
  const result = db.prepare("UPDATE workflow SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ?").run(secret, trimmed);
  if (result.changes === 0) throw new Error('Workflow not found');
  return secret;
}

/** Cap webhook HMAC inputs (runaway body / header defense). */
export const WEBHOOK_BODY_MAX_CHARS = 1 * 1024 * 1024;
export const WEBHOOK_SIGNATURE_HEADER_MAX_CHARS = 512;
export const WEBHOOK_SECRET_MAX_CHARS = 8_192;

/** Constant-time HMAC-SHA256 signature verification. */
export function verifyWebhookSignature(secret: string, body: string, signatureHeader: string): boolean {
  try {
    if (typeof secret !== 'string' || typeof body !== 'string' || typeof signatureHeader !== 'string') {
      return false;
    }
    // Reject control-char secrets / headers before trim
    if (/[\0\r\n]/.test(secret) || /[\0\r\n]/.test(signatureHeader)) return false;
    if (secret.length > WEBHOOK_SECRET_MAX_CHARS) return false;
    if (signatureHeader.length > WEBHOOK_SIGNATURE_HEADER_MAX_CHARS) return false;
    if (body.length > WEBHOOK_BODY_MAX_CHARS) return false;
    const key = secret.trim();
    if (!key) return false;
    const header = signatureHeader.trim();
    const eq = header.indexOf('=');
    if (eq <= 0) return false;
    const algo = header.slice(0, eq).trim().toLowerCase();
    const sig = header.slice(eq + 1).trim();
    if (algo !== 'sha256' || !sig) return false;
    const expected = createHmac('sha256', key).update(body).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
