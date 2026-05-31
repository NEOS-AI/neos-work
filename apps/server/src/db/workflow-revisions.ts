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
}

interface RevisionRow {
  id: string;
  workflow_id: string;
  snapshot: string;
  label: string | null;
  created_at: string;
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
  const db = getDb();
  const rows = db
    .prepare('SELECT id, workflow_id, label, created_at FROM workflow_revisions WHERE workflow_id = ? ORDER BY created_at DESC')
    .all(workflowId) as Omit<RevisionRow, 'snapshot'>[];
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    label: row.label ?? undefined,
    createdAt: row.created_at,
  }));
}

export function getRevision(revisionId: string): WorkflowRevision | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workflow_revisions WHERE id = ?').get(revisionId) as RevisionRow | undefined;
  return row ? rowToRevision(row) : undefined;
}

export function createRevision(workflowId: string, snapshot: string, label?: string): WorkflowRevision {
  const db = getDb();
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
  const db = getDb();
  const result = db.prepare('UPDATE workflow_revisions SET label = ? WHERE id = ?').run(label, revisionId);
  return result.changes > 0;
}

export function deleteRevision(revisionId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM workflow_revisions WHERE id = ?').run(revisionId);
  return result.changes > 0;
}
