/**
 * Workflow revision routes.
 * GET    /api/workflow-revisions/:workflowId                    — list revisions (no snapshot)
 * GET    /api/workflow-revisions/:workflowId/:id                — get single revision (with snapshot)
 * POST   /api/workflow-revisions/:workflowId/:id/restore       — apply snapshot to workflow (plan Task 16)
 * PATCH  /api/workflow-revisions/:workflowId/:id                — update label
 * DELETE /api/workflow-revisions/:workflowId/:id                — delete revision
 */

import { Hono } from 'hono';
import * as db from '../db/workflow-revisions.js';
import * as workflowDb from '../db/workflows.js';
import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';
import { safeRouteId } from '../lib/path-safety.js';

const workflowRevisions = new Hono();

/** Cap path params (plan Task 16 route hygiene). */
function safeId(raw: string): string {
  return safeRouteId(raw);
}

function paramIds(c: { req: { param: (k: string) => string } }): {
  workflowId: string;
  id: string;
} {
  return {
    workflowId: safeId(c.req.param('workflowId')),
    id: safeId(c.req.param('id')),
  };
}

workflowRevisions.get('/:workflowId', (c) => {
  const workflowId = safeId(c.req.param('workflowId'));
  if (!workflowId) return c.json({ ok: false, error: 'Not found' }, 404);
  const wf = workflowDb.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: db.listRevisions(workflowId) });
});

workflowRevisions.get('/:workflowId/:id', (c) => {
  const { workflowId, id } = paramIds(c);
  if (!workflowId || !id) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getRevision(id);
  if (!rev || rev.workflowId !== workflowId) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true, data: rev });
});

/**
 * Apply a revision snapshot to the live workflow record (plan Task 16).
 * Snapshots current state first (unless identical) so restore is reversible.
 */
workflowRevisions.post('/:workflowId/:id/restore', async (c) => {
  const { workflowId, id } = paramIds(c);
  if (!workflowId || !id) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getRevision(id);
  if (!rev || rev.workflowId !== workflowId) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }

  const current = workflowDb.getWorkflow(workflowId);
  if (!current) return c.json({ ok: false, error: 'Not found' }, 404);

  let snap: {
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    name?: string;
    description?: string;
    designSystemId?: string | null;
  };
  // Bound snapshot size before parse (align with REVISION_SNAPSHOT_MAX_CHARS)
  if (typeof rev.snapshot !== 'string' || rev.snapshot.length > db.REVISION_SNAPSHOT_MAX_CHARS) {
    return c.json({ ok: false, error: 'Snapshot too large or invalid' }, 400);
  }
  try {
    snap = JSON.parse(rev.snapshot) as typeof snap;
  } catch {
    return c.json({ ok: false, error: 'Invalid snapshot JSON' }, 400);
  }

  if (!Array.isArray(snap.nodes) || !Array.isArray(snap.edges)) {
    return c.json({ ok: false, error: 'Snapshot missing nodes/edges' }, 400);
  }
  // Cap graph size on restore (align with workflows graph caps)
  if (snap.nodes.length > 2_000 || snap.edges.length > 10_000) {
    return c.json({ ok: false, error: 'Snapshot graph exceeds size limits' }, 400);
  }

  // Snapshot current state before overwrite (dedup may skip if identical)
  db.createRevision(
    workflowId,
    JSON.stringify({
      name: current.name,
      description: current.description,
      designSystemId: current.designSystemId,
      nodes: current.nodes,
      edges: current.edges,
    }),
    'pre-restore',
  );

  const updated = workflowDb.updateWorkflow(workflowId, {
    name: typeof snap.name === 'string' ? snap.name : undefined,
    description: typeof snap.description === 'string' ? snap.description : undefined,
    designSystemId:
      snap.designSystemId === null
        ? ''
        : typeof snap.designSystemId === 'string'
          ? snap.designSystemId
          : undefined,
    nodes: snap.nodes,
    edges: snap.edges,
  });

  if (!updated) return c.json({ ok: false, error: 'Failed to restore' }, 500);
  return c.json({
    ok: true,
    data: updated,
    meta: { restoredFrom: rev.id, label: rev.label },
  });
});

workflowRevisions.patch('/:workflowId/:id', async (c) => {
  const { workflowId, id } = paramIds(c);
  if (!workflowId || !id) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getRevision(id);
  if (!rev || rev.workflowId !== workflowId) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  const body = await c.req.json<{ label?: string }>().catch(() => null);
  if (typeof body?.label !== 'string' || /[\0\r\n]/.test(body.label)) {
    return c.json({ ok: false, error: 'Invalid label' }, 400);
  }
  const label = body.label.trim();
  if (!label || label.length > 200) {
    return c.json({ ok: false, error: 'Invalid label' }, 400);
  }
  db.updateRevisionLabel(id, label);
  return c.json({ ok: true, data: db.getRevision(id) });
});

workflowRevisions.delete('/:workflowId/:id', (c) => {
  const { workflowId, id } = paramIds(c);
  if (!workflowId || !id) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getRevision(id);
  if (!rev || rev.workflowId !== workflowId) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  db.deleteRevision(id);
  return c.json({ ok: true });
});

export default workflowRevisions;
