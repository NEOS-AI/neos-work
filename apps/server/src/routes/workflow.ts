/**
 * Workflow REST routes.
 * GET    /api/workflow          — list workflows
 * POST   /api/workflow          — create workflow
 * GET    /api/workflow/:id      — get workflow
 * PUT    /api/workflow/:id      — update workflow
 * DELETE /api/workflow/:id      — delete workflow
 * POST   /api/workflow/:id/run  — run workflow (SSE)
 * GET    /api/workflow/:id/runs — list runs
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { WorkflowSSEEvent } from '@neos-work/shared';
import { executeWorkflow } from '@neos-work/workflow-engine';
import * as db from '../db/workflows.js';
import { getWorkflowSecrets } from '../db/settings.js';

const workflow = new Hono();

// ── CRUD ──────────────────────────────────────────────────

workflow.get('/', (c) => {
  return c.json({ ok: true, data: db.listWorkflows() });
});

workflow.get('/:id', (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: wf });
});

workflow.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    domain?: string;
    nodes?: unknown[];
    edges?: unknown[];
  }>();

  if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  const wf = db.createWorkflow({
    name: body.name,
    description: body.description,
    domain: body.domain ?? 'general',
    nodes: (body.nodes as never) ?? [],
    edges: (body.edges as never) ?? [],
  });

  return c.json({ ok: true, data: wf }, 201);
});

workflow.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    nodes?: unknown[];
    edges?: unknown[];
  }>();

  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 200)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  const updated = db.updateWorkflow(id, {
    name: body.name,
    description: body.description,
    nodes: body.nodes as never,
    edges: body.edges as never,
  });

  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: updated });
});

workflow.delete('/:id', (c) => {
  const deleted = db.deleteWorkflow(c.req.param('id'));
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Runs ──────────────────────────────────────────────────

workflow.get('/:id/runs', (c) => {
  const runs = db.listRuns(c.req.param('id'));
  return c.json({ ok: true, data: runs });
});

/** SSE stream: POST /api/workflow/:id/run */
workflow.post('/:id/run', async (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const settings = getWorkflowSecrets();
  const controller = new AbortController();

  // Create an initial run record
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const nodeResults: Record<string, unknown> = {};
  db.saveRun({
    id: runId,
    workflowId: wf.id,
    status: 'running',
    nodeResults: nodeResults as never,
    startedAt: now,
  });

  return stream(c, async (writableStream) => {
    const sendEvent = async (event: WorkflowSSEEvent) => {
      await writableStream.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    c.req.raw.signal.addEventListener('abort', () => controller.abort());

    try {
      await executeWorkflow({
        runId,
        workflow: wf,
        settings,
        onEvent: (event) => {
          sendEvent(event).catch(() => controller.abort());

          // Track node results in memory for final save
          if (event.type === 'node.completed') {
            nodeResults[event.nodeId] = { status: 'completed', output: event.output };
          }
          if (event.type === 'node.failed') {
            nodeResults[event.nodeId] = { status: 'failed', error: event.error };
          }
        },
        signal: controller.signal,
      });

      const finalStatus = controller.signal.aborted ? 'cancelled' : 'completed';

      db.saveRun({
        id: runId,
        workflowId: wf.id,
        status: finalStatus,
        nodeResults: nodeResults as never,
        startedAt: now,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Execution error';
      await sendEvent({ type: 'run.failed', runId, error: errorMsg });
      db.saveRun({
        id: runId,
        workflowId: wf.id,
        status: 'failed',
        nodeResults: nodeResults as never,
        startedAt: now,
        completedAt: new Date().toISOString(),
        error: errorMsg,
      });
    }
  });
});

export default workflow;
