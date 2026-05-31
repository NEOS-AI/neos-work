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
import archiver from 'archiver';
import unzipper from 'unzipper';
import { Readable } from 'node:stream';
import type { WorkflowSSEEvent } from '@neos-work/shared';
import { executeWorkflow } from '@neos-work/workflow-engine';
import * as db from '../db/workflows.js';
import * as artifactDb from '../db/artifacts.js';
import * as revisionDb from '../db/workflow-revisions.js';
import { getWorkflowSecrets } from '../db/settings.js';
import { spawnCliAgent } from '../lib/cli-agents.js';
import { getDesignSystemContent } from '../lib/design-system-store.js';

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
    designSystemId?: string;
    nodes?: unknown[];
    edges?: unknown[];
  }>();

  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 200)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  // Auto-snapshot before update (Task 16: version history)
  const current = db.getWorkflow(id);
  if (current) {
    const snapshot = JSON.stringify({
      name: current.name,
      description: current.description,
      nodes: current.nodes,
      edges: current.edges,
    });
    revisionDb.createRevision(id, snapshot);
  }

  const updated = db.updateWorkflow(id, {
    name: body.name,
    description: body.description,
    designSystemId: body.designSystemId,
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

// ── Import/Export/Duplicate ────────────────────────────────

workflow.post('/import', async (c) => {
  const body = await c.req.json<{
    version?: string;
    workflow?: {
      name?: string;
      description?: string;
      domain?: string;
      nodes?: unknown[];
      edges?: unknown[];
    };
  }>().catch(() => null);

  if (!body || body.version !== '1' || !body.workflow) {
    return c.json({ ok: false, error: 'Invalid import format or unsupported version' }, 400);
  }

  const wf = body.workflow;
  const rawName = typeof wf.name === 'string' && wf.name.length > 0 ? wf.name.slice(0, 200) : 'Imported Workflow';
  const existing = db.listWorkflows().find((w) => w.name === rawName);
  const finalName = existing ? `${rawName} (imported)` : rawName;

  const created = db.createWorkflow({
    name: finalName,
    description: typeof wf.description === 'string' ? wf.description : undefined,
    domain: (['finance', 'coding', 'general'] as const).includes(wf.domain as never)
      ? (wf.domain as 'finance' | 'coding' | 'general')
      : 'general',
    nodes: (wf.nodes as never) ?? [],
    edges: (wf.edges as never) ?? [],
  });

  return c.json({ ok: true, data: created }, 201);
});

workflow.post('/:id/duplicate', (c) => {
  const copy = db.duplicateWorkflow(c.req.param('id'));
  if (!copy) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: copy }, 201);
});

workflow.get('/:id/export', (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  const safeName = wf.name.replace(/[^a-z0-9_-]/gi, '_');
  c.header('Content-Disposition', `attachment; filename="${safeName}.neos.json"`);
  return c.json({
    version: '1',
    exportedAt: new Date().toISOString(),
    workflow: {
      name: wf.name,
      description: wf.description,
      domain: wf.domain,
      nodes: wf.nodes,
      edges: wf.edges,
    },
  });
});

workflow.get('/:id/export.zip', async (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  const safeName = wf.name.replace(/[^a-z0-9_-]/gi, '_');

  const manifest = JSON.stringify({
    version: '1',
    exportedAt: new Date().toISOString(),
    workflow: {
      name: wf.name,
      description: wf.description,
      domain: wf.domain,
      nodes: wf.nodes,
      edges: wf.edges,
    },
  }, null, 2);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.append(manifest, { name: 'workflow.json' });
  archive.append(`# ${wf.name}\n\n${wf.description ?? ''}\n`, { name: 'README.md' });
  archive.finalize();

  const chunks: Buffer[] = [];
  for await (const chunk of archive) {
    chunks.push(Buffer.from(chunk));
  }
  const buf = Buffer.concat(chunks);

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${safeName}.neos.zip"`);
  return c.body(buf);
});

workflow.post('/import.zip', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data') && !contentType.includes('application/octet-stream') && !contentType.includes('application/zip')) {
    return c.json({ ok: false, error: 'Expected multipart/form-data or application/zip' }, 400);
  }

  let zipBuffer: Buffer;
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return c.json({ ok: false, error: 'Missing file field' }, 400);
    const ab = await file.arrayBuffer();
    zipBuffer = Buffer.from(ab);
  } else {
    const ab = await c.req.arrayBuffer();
    zipBuffer = Buffer.from(ab);
  }

  // Parse ZIP in-memory
  const dir = await unzipper.Open.buffer(zipBuffer);
  const manifestFile = dir.files.find((f) => f.path === 'workflow.json');
  if (!manifestFile) return c.json({ ok: false, error: 'workflow.json not found in ZIP' }, 400);

  const rawJson = (await manifestFile.buffer()).toString('utf-8');
  let manifest: { version?: string; workflow?: Record<string, unknown> };
  try {
    manifest = JSON.parse(rawJson);
  } catch {
    return c.json({ ok: false, error: 'Invalid workflow.json' }, 400);
  }
  if (manifest.version !== '1' || !manifest.workflow) {
    return c.json({ ok: false, error: 'Unsupported version' }, 400);
  }

  const wf = manifest.workflow;
  const rawName = typeof wf.name === 'string' && wf.name.length > 0 ? wf.name.slice(0, 200) : 'Imported Workflow';
  const existing = db.listWorkflows().find((w) => w.name === rawName);
  const finalName = existing ? `${rawName} (imported)` : rawName;

  const created = db.createWorkflow({
    name: finalName,
    description: typeof wf.description === 'string' ? wf.description : undefined,
    domain: (['finance', 'coding', 'general'] as const).includes(wf.domain as never)
      ? (wf.domain as 'finance' | 'coding' | 'general')
      : 'general',
    nodes: (wf.nodes as never) ?? [],
    edges: (wf.edges as never) ?? [],
  });

  return c.json({ ok: true, data: created }, 201);
});

// ── Runs ──────────────────────────────────────────────────

workflow.get('/:id/runs', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = Number(c.req.query('offset') ?? '0');
  const runs = db.listRuns(c.req.param('id'), limit, offset);
  return c.json({ ok: true, data: runs });
});

workflow.delete('/:id/runs/:runId', (c) => {
  const run = db.getRun(c.req.param('runId'));
  if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
  if (run.workflowId !== c.req.param('id')) return c.json({ ok: false, error: 'Not found' }, 404);
  db.deleteRun(run.id);
  return c.json({ ok: true });
});

workflow.get('/:id/runs/:runId', (c) => {
  const run = db.getRun(c.req.param('runId'));
  if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
  // Ensure the run belongs to the requested workflow
  if (run.workflowId !== c.req.param('id')) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: run });
});

/** SSE stream: POST /api/workflow/:id/run */
workflow.post('/:id/run', async (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  // Parse optional trigger inputs from request body
  let triggerInputs: Record<string, unknown> = {};
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const body = await c.req.json<{ inputs?: Record<string, unknown> }>();
      if (body.inputs && typeof body.inputs === 'object') {
        triggerInputs = body.inputs;
      }
    } catch {
      // No body or invalid JSON — proceed with empty inputs
    }
  }

  const settings = getWorkflowSecrets();
  const controller = new AbortController();

  // Load Design System content if the workflow has one configured
  const designSystemContent = wf.designSystemId
    ? (await getDesignSystemContent(wf.designSystemId)) ?? undefined
    : undefined;

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
        triggerInputs,
        workflow: wf,
        settings,
        onEvent: (event) => {
          sendEvent(event).catch(() => controller.abort());

          // Track node results in memory for final save
          if (event.type === 'node.completed') {
            nodeResults[event.nodeId] = { status: 'completed', output: event.output, durationMs: event.durationMs };
          }
          if (event.type === 'node.failed') {
            nodeResults[event.nodeId] = { status: 'failed', error: event.error };
          }
        },
        signal: controller.signal,
        cliSpawn: (cliId, prompt, onChunk, signal) =>
          spawnCliAgent({ cliId, prompt, onChunk, signal }),
        designSystemContent,
      });

      // Auto-detect HTML artifacts from completed node outputs
      let artifactId: string | undefined;
      for (const [nodeId, result] of Object.entries(nodeResults)) {
        const r = result as { output?: unknown; status?: string };
        if (r.status === 'completed' && typeof r.output === 'string' && r.output.trim().startsWith('<')) {
          const htmlContent = r.output.trim();
          if (htmlContent.includes('<html') || htmlContent.includes('<div') || htmlContent.includes('<svg')) {
            const artifact = artifactDb.createArtifact({
              workflowId: wf.id,
              runId,
              name: `Output (${nodeId})`,
              contentType: 'text/html',
              content: htmlContent,
              nodeId,
            });
            artifactId = artifact.id;
            break; // Only save first HTML artifact per run
          }
        }
      }

      // Send supplementary artifact event if one was created
      if (artifactId) {
        await sendEvent({ type: 'run.completed', runId, duration: 0, artifactId });
      }

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
