/**
 * Artifacts routes.
 * GET  /api/artifacts?workflowId=...   — list by workflow
 * GET  /api/artifacts?runId=...        — list by run
 * GET  /api/artifacts/:id              — get single (returns full content)
 * POST /api/artifacts                  — create
 * PUT  /api/artifacts/:id              — update content
 * DELETE /api/artifacts/:id            — delete
 */

import { Hono } from 'hono';
import * as db from '../db/artifacts.js';

const artifacts = new Hono();

artifacts.get('/', (c) => {
  const workflowId = c.req.query('workflowId');
  const runId = c.req.query('runId');

  if (runId) {
    return c.json({ ok: true, data: db.listArtifactsByRun(runId) });
  }
  if (workflowId) {
    return c.json({ ok: true, data: db.listArtifacts(workflowId) });
  }
  return c.json({ ok: false, error: 'workflowId or runId query param required' }, 400);
});

artifacts.get('/:id', (c) => {
  const artifact = db.getArtifact(c.req.param('id'));
  if (!artifact) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: artifact });
});

artifacts.post('/', async (c) => {
  const body = await c.req.json<{
    workflowId: string;
    runId?: string;
    name: string;
    contentType: string;
    content?: string;
    nodeId?: string;
  }>().catch(() => null);

  if (!body?.workflowId || !body.name || !body.contentType) {
    return c.json({ ok: false, error: 'workflowId, name, contentType required' }, 400);
  }

  const artifact = db.createArtifact({
    workflowId: body.workflowId,
    runId: body.runId,
    name: body.name,
    contentType: body.contentType,
    content: body.content,
    nodeId: body.nodeId,
  });
  return c.json({ ok: true, data: artifact }, 201);
});

artifacts.put('/:id', async (c) => {
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  const updated = db.updateArtifactContent(c.req.param('id'), body.content);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: updated });
});

artifacts.delete('/:id', (c) => {
  const deleted = db.deleteArtifact(c.req.param('id'));
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default artifacts;
