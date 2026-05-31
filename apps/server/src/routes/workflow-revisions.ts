/**
 * Workflow revision routes.
 * GET    /api/workflow-revisions/:workflowId          — list revisions (no snapshot)
 * GET    /api/workflow-revisions/:workflowId/:id      — get single revision (with snapshot)
 * PATCH  /api/workflow-revisions/:workflowId/:id      — update label
 * DELETE /api/workflow-revisions/:workflowId/:id      — delete revision
 */

import { Hono } from 'hono';
import * as db from '../db/workflow-revisions.js';
import * as workflowDb from '../db/workflows.js';

const workflowRevisions = new Hono();

workflowRevisions.get('/:workflowId', (c) => {
  const wf = workflowDb.getWorkflow(c.req.param('workflowId'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: db.listRevisions(c.req.param('workflowId')) });
});

workflowRevisions.get('/:workflowId/:id', (c) => {
  const rev = db.getRevision(c.req.param('id'));
  if (!rev || rev.workflowId !== c.req.param('workflowId')) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true, data: rev });
});

workflowRevisions.patch('/:workflowId/:id', async (c) => {
  const rev = db.getRevision(c.req.param('id'));
  if (!rev || rev.workflowId !== c.req.param('workflowId')) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  const body = await c.req.json<{ label?: string }>();
  if (typeof body.label !== 'string' || body.label.length > 200) {
    return c.json({ ok: false, error: 'Invalid label' }, 400);
  }
  db.updateRevisionLabel(c.req.param('id'), body.label);
  return c.json({ ok: true, data: db.getRevision(c.req.param('id')) });
});

workflowRevisions.delete('/:workflowId/:id', (c) => {
  const rev = db.getRevision(c.req.param('id'));
  if (!rev || rev.workflowId !== c.req.param('workflowId')) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  db.deleteRevision(c.req.param('id'));
  return c.json({ ok: true });
});

export default workflowRevisions;
