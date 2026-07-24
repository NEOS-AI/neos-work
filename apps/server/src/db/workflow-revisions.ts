/**
 * Workflow revisions DB operations.
 * Auto-snapshots taken before each PUT /api/workflow/:id save.
 * Max 50 revisions per workflow (oldest auto-GC'd).
 */

import { getDb } from './schema.js';

export interface WorkflowRevision {
  id: string;
  workflowId: string;
  snapshot: string;  // JSON string of { nodes, edges, name, description }
  label?: string;
  createdAt: string;
  /** Populated on list responses (plan Task 16 — date, label, node count). */
  nodeCount?: number;
  edgeCount?: number;
}

interface RevisionRow {
  id: string;
  workflow_id: string;
  snapshot: string;
  label: string | null;
  created_at: string;
}

function parseSnapshotCounts(snapshot: string): { nodeCount?: number; edgeCount?: number } {
  try {
    const parsed = JSON.parse(snapshot) as { nodes?: unknown; edges?: unknown };
    return {
      nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : undefined,
      edgeCount: Array.isArray(parsed.edges) ? parsed.edges.length : undefined,
    };
  } catch {
    return {};
  }
}

function rowToRevision(row: RevisionRow): WorkflowRevision {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    snapshot: row.snapshot,
    label: row.label ?? undefined,
    createdAt: row.created_at,
  };
}

const MAX_REVISIONS = 50;

export function listRevisions(workflowId: string): Omit<WorkflowRevision, 'snapshot'>[] {
  const wfId = typeof workflowId === 'string' ? workflowId.trim() : '';
  if (!wfId) return [];
  const db = getDb();
  // Include snapshot only to derive node/edge counts for History panel (not returned to client as raw blob).
  const rows = db
    .prepare(
      'SELECT id, workflow_id, snapshot, label, created_at FROM workflow_revisions WHERE workflow_id = ? ORDER BY created_at DESC',
    )
    .all(wfId) as RevisionRow[];
  return rows.map((row) => {
    const counts = parseSnapshotCounts(row.snapshot);
    return {
      id: row.id,
      workflowId: row.workflow_id,
      label: row.label ?? undefined,
      createdAt: row.created_at,
      nodeCount: counts.nodeCount,
      edgeCount: counts.edgeCount,
    };
  });
}

export function getRevision(revisionId: string): WorkflowRevision | undefined {
  const trimmed = typeof revisionId === 'string' ? revisionId.trim() : '';
  if (!trimmed) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_revisions WHERE id = ?').get(trimmed) as RevisionRow | undefined;
  return row ? rowToRevision(row) : undefined;
}

/**
 * Create a revision snapshot.
 * Returns null when the latest snapshot is identical (dedup — plan Task 16).
 */
export function createRevision(
  workflowId: string,
  snapshot: string,
  label?: string,
): WorkflowRevision | null {
  const db = getDb();

  // Skip identical consecutive snapshots
  const latest = db
    .prepare(
      'SELECT id, workflow_id, snapshot, label, created_at FROM workflow_revisions WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(workflowId) as RevisionRow | undefined;
  if (latest && latest.snapshot === snapshot) {
    return null;
  }

  const id = crypto.randomUUID();

  db.prepare(
    'INSERT INTO workflow_revisions (id, workflow_id, snapshot, label) VALUES (?, ?, ?, ?)',
  ).run(id, workflowId, snapshot, label ?? null);

  // GC: keep only the latest MAX_REVISIONS revisions
  const toDelete = db
    .prepare(
      `SELECT id FROM workflow_revisions WHERE workflow_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ${MAX_REVISIONS}`,
    )
    .all(workflowId) as Array<{ id: string }>;

  for (const old of toDelete) {
    db.prepare('DELETE FROM workflow_revisions WHERE id = ?').run(old.id);
  }

  return getRevision(id)!;
}

export function updateRevisionLabel(revisionId: string, label: string): boolean {
  const trimmed = typeof revisionId === 'string' ? revisionId.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('UPDATE workflow_revisions SET label = ? WHERE id = ?').run(label, trimmed);
  return result.changes > 0;
}

export function deleteRevision(revisionId: string): boolean {
  const trimmed = typeof revisionId === 'string' ? revisionId.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow_revisions WHERE id = ?').run(trimmed);
  return result.changes > 0;
}
