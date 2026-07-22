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

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    domain: row.domain as Workflow['domain'],
    nodes: JSON.parse(row.nodes_json) as WorkflowNode[],
    edges: JSON.parse(row.edges_json) as WorkflowEdge[],
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
    nodeResults: JSON.parse(row.node_results_json) as Record<string, NodeRunResult>,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

export function listWorkflows(): Workflow[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflow ORDER BY updated_at DESC')
    .all() as WorkflowRow[];
  return rows.map(rowToWorkflow);
}

export function getWorkflow(id: string): Workflow | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow WHERE id = ?').get(id) as WorkflowRow | undefined;
  return row ? rowToWorkflow(row) : undefined;
}

export function createWorkflow(input: {
  name: string;
  description?: string;
  domain: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Workflow {
  const db = getDb();
  const id = crypto.randomUUID();
  const name = input.name.trim();
  const description =
    input.description !== undefined
      ? (input.description.trim() || null)
      : null;
  db.prepare(
    `INSERT INTO workflow (id, name, description, domain, nodes_json, edges_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    description,
    input.domain,
    JSON.stringify(input.nodes),
    JSON.stringify(input.edges),
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
  const db = getDb();
  const existing = db.prepare('SELECT * FROM workflow WHERE id = ?').get(id) as WorkflowRow | undefined;
  if (!existing) return undefined;

  const name =
    input.name !== undefined ? input.name.trim() || existing.name : existing.name;
  const description =
    input.description !== undefined
      ? (input.description.trim() || null)
      : existing.description;
  const designSystemId = input.designSystemId !== undefined
    ? ((input.designSystemId ?? '').trim() || null)
    : existing.design_system_id;
  const nodes = input.nodes !== undefined ? JSON.stringify(input.nodes) : existing.nodes_json;
  const edges = input.edges !== undefined ? JSON.stringify(input.edges) : existing.edges_json;

  db.prepare(
    `UPDATE workflow SET name = ?, description = ?, design_system_id = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, description, designSystemId, nodes, edges, id);

  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow WHERE id = ?').run(id);
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

export function saveRun(run: WorkflowRun): void {
  const db = getDb();
  const nodeResultsStr = JSON.stringify(run.nodeResults);
  // Enforce 1MB limit on stored results
  const truncated = nodeResultsStr.length > 1_048_576;
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
    run.id,
    run.workflowId,
    run.status,
    stored,
    run.startedAt,
    run.completedAt ?? null,
    run.error ?? null,
  );
}

export function getRun(runId: string): WorkflowRun | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workflow_run WHERE id = ?')
    .get(runId) as WorkflowRunRow | undefined;
  return row ? rowToRun(row) : undefined;
}

export function listRuns(workflowId: string, limit = 20, offset = 0): WorkflowRun[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflow_run WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?')
    .all(workflowId, limit, offset) as WorkflowRunRow[];
  return rows.map(rowToRun);
}

export function deleteRun(runId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow_run WHERE id = ?').run(runId);
  return result.changes > 0;
}

/**
 * Delete runs for a workflow. Optional status filter (completed|failed|cancelled|running).
 * Returns number of deleted rows.
 */
export function deleteRuns(workflowId: string, status?: string): number {
  const db = getDb();
  if (status) {
    const result = db
      .prepare('DELETE FROM workflow_run WHERE workflow_id = ? AND status = ?')
      .run(workflowId, status);
    return result.changes;
  }
  const result = db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(workflowId);
  return result.changes;
}

// ── Webhook ────────────────────────────────────────────────

export function getOrCreateWebhookSecret(workflowId: string): string {
  const db = getDb();
  const row = db.prepare('SELECT webhook_secret FROM workflow WHERE id = ?').get(workflowId) as { webhook_secret: string | null } | undefined;
  if (!row) throw new Error('Workflow not found');

  if (row.webhook_secret) return row.webhook_secret;

  const secret = randomBytes(32).toString('hex');
  db.prepare("UPDATE workflow SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ?").run(secret, workflowId);
  return secret;
}

export function regenerateWebhookSecret(workflowId: string): string {
  const db = getDb();
  const secret = randomBytes(32).toString('hex');
  const result = db.prepare("UPDATE workflow SET webhook_secret = ?, updated_at = datetime('now') WHERE id = ?").run(secret, workflowId);
  if (result.changes === 0) throw new Error('Workflow not found');
  return secret;
}

/** Constant-time HMAC-SHA256 signature verification. */
export function verifyWebhookSignature(secret: string, body: string, signatureHeader: string): boolean {
  try {
    const key = secret.trim();
    if (!key) return false;
    const header = signatureHeader.trim();
    const eq = header.indexOf('=');
    if (eq <= 0) return false;
    const algo = header.slice(0, eq).trim();
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
