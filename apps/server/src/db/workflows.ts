/**
 * Workflow CRUD operations (SQLite).
 */

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
  db.prepare(
    `INSERT INTO workflow (id, name, description, domain, nodes_json, edges_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.description ?? null,
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
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
  },
): Workflow | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM workflow WHERE id = ?').get(id) as WorkflowRow | undefined;
  if (!existing) return undefined;

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const nodes = input.nodes !== undefined ? JSON.stringify(input.nodes) : existing.nodes_json;
  const edges = input.edges !== undefined ? JSON.stringify(input.edges) : existing.edges_json;

  db.prepare(
    `UPDATE workflow SET name = ?, description = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, description, nodes, edges, id);

  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow WHERE id = ?').run(id);
  return result.changes > 0;
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

export function listRuns(workflowId: string): WorkflowRun[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM workflow_run WHERE workflow_id = ? ORDER BY started_at DESC')
    .all(workflowId) as WorkflowRunRow[];
  return rows.map(rowToRun);
}
