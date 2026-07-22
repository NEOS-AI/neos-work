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
import { getExecutionSettings } from '../db/settings.js';
import { spawnCliAgent } from '../lib/cli-agents.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from '../lib/runtime-context.js';
import {
  createDesignSystem,
  getDesignSystemContent,
  updateDesignSystemContent,
} from '../lib/design-system-store.js';
import { createFirstHtmlArtifact } from '../lib/html-artifact.js';
import { assessWorkflowPreflight } from '../lib/workflow-preflight.js';

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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  const description =
    typeof body.description === 'string' ? body.description.trim() || undefined : body.description;

  const wf = db.createWorkflow({
    name,
    description,
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

  const name =
    body.name !== undefined
      ? (typeof body.name === 'string' ? body.name.trim() : '')
      : undefined;
  if (name !== undefined && (!name || name.length > 200)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  const description =
    body.description !== undefined && typeof body.description === 'string'
      ? body.description.trim()
      : body.description;

  // Auto-snapshot before update (Task 16: version history)
  const current = db.getWorkflow(id);
  if (current) {
    const snapshot = JSON.stringify({
      name: current.name,
      description: current.description,
      designSystemId: current.designSystemId,
      nodes: current.nodes,
      edges: current.edges,
    });
    revisionDb.createRevision(id, snapshot);
  }

  const updated = db.updateWorkflow(id, {
    name,
    description,
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

  const runs = db.listRuns(wf.id, 10, 0);
  const artifacts = artifactDb.listArtifacts(wf.id);

  const manifest = JSON.stringify({
    version: '1',
    exportedAt: new Date().toISOString(),
    workflow: {
      name: wf.name,
      description: wf.description,
      domain: wf.domain,
      designSystemId: wf.designSystemId,
      nodes: wf.nodes,
      edges: wf.edges,
    },
    runCount: runs.length,
    artifactCount: artifacts.length,
  }, null, 2);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.append(manifest, { name: 'workflow.json' });
  archive.append(
    `# ${wf.name}\n\n${wf.description ?? ''}\n\nExported from NEOS Work with ${runs.length} recent run(s) and ${artifacts.length} artifact(s).\n`,
    { name: 'README.md' },
  );

  // Recent runs (skip dotfiles / internal noise)
  for (const run of runs) {
    const payload = JSON.stringify({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
      nodeResults: run.nodeResults,
    }, null, 2);
    archive.append(payload, { name: `runs/${run.id}.json` });
  }

  // Artifacts — inline HTML/markdown content only (no binary path dumps)
  for (const art of artifacts) {
    if (!art.content) continue;
    const safeArt = art.name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || art.id.slice(0, 8);
    const ext =
      art.contentType.includes('html') ? 'html'
        : art.contentType.includes('markdown') ? 'md'
          : 'txt';
    archive.append(art.content, { name: `artifacts/${safeArt}-${art.id.slice(0, 8)}.${ext}` });
    archive.append(
      JSON.stringify({
        id: art.id,
        name: art.name,
        contentType: art.contentType,
        nodeId: art.nodeId,
        runId: art.runId,
        createdAt: art.createdAt,
      }, null, 2),
      { name: `artifacts/${safeArt}-${art.id.slice(0, 8)}.meta.json` },
    );
  }

  // Design system DESIGN.md when workflow is bound (plan Tasks 1 / 10)
  if (wf.designSystemId) {
    try {
      const content = await getDesignSystemContent(wf.designSystemId);
      if (content) {
        archive.append(content, { name: `design-systems/${wf.designSystemId}/DESIGN.md` });
        archive.append(
          JSON.stringify({ id: wf.designSystemId, exportedAt: new Date().toISOString() }, null, 2),
          { name: `design-systems/${wf.designSystemId}/meta.json` },
        );
      }
    } catch {
      // non-fatal — export without design system content
    }
  }

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

type ZipBufferResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; error: string; status: 400 };

async function readZipBuffer(c: {
  req: {
    header: (n: string) => string | undefined;
    formData: () => Promise<FormData>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
}): Promise<ZipBufferResult> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data') && !contentType.includes('application/octet-stream') && !contentType.includes('application/zip')) {
    return { ok: false, error: 'Expected multipart/form-data or application/zip', status: 400 };
  }
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return { ok: false, error: 'Missing file field', status: 400 };
    }
    return { ok: true, buffer: Buffer.from(await file.arrayBuffer()) };
  }
  return { ok: true, buffer: Buffer.from(await c.req.arrayBuffer()) };
}

/**
 * Claude Design / HTML-only ZIP: no workflow.json, but has index.html or other HTML entry.
 * Creates a workflow with trigger→output and stores HTML as an artifact.
 */
async function importClaudeDesignZip(
  dir: Awaited<ReturnType<typeof unzipper.Open.buffer>>,
  preferredName?: string,
) {
  const htmlFiles = dir.files.filter((f) => {
    const p = f.path.replace(/\\/g, '/');
    if (p.startsWith('__MACOSX/') || p.includes('/.')) return false;
    return /\.html?$/i.test(p) && f.type !== 'Directory';
  });
  if (htmlFiles.length === 0) return null;

  // Prefer index.html / Index.html at root, else first HTML by path length
  const entry =
    htmlFiles.find((f) => /(^|\/)index\.html?$/i.test(f.path.replace(/\\/g, '/')))
    ?? htmlFiles.sort((a, b) => a.path.length - b.path.length)[0]!;

  const html = (await entry.buffer()).toString('utf-8');
  const baseFromZip = preferredName
    ?? entry.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.html?$/i, '')
    ?? 'Claude Design Import';
  const rawName = baseFromZip.slice(0, 200) || 'Claude Design Import';
  const existing = db.listWorkflows().find((w) => w.name === rawName);
  const finalName = existing ? `Copy of ${rawName}` : rawName;

  const triggerId = crypto.randomUUID();
  const outputId = crypto.randomUUID();
  const created = db.createWorkflow({
    name: finalName,
    description: `Imported from Claude Design ZIP (entry: ${entry.path})`,
    domain: 'general',
    nodes: [
      { id: triggerId, type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
      { id: outputId, type: 'output', label: 'Output', position: { x: 520, y: 200 }, config: {} },
    ],
    edges: [{ id: crypto.randomUUID(), source: triggerId, target: outputId }],
  });

  const artifact = artifactDb.createArtifact({
    workflowId: created.id,
    name: entry.path.replace(/\\/g, '/').split('/').pop() ?? 'index.html',
    contentType: 'text/html',
    content: html,
  });

  return { workflow: created, artifactId: artifact.id, importKind: 'claude-design' as const };
}

workflow.post('/import.zip', async (c) => {
  const zipOrErr = await readZipBuffer(c);
  if (!zipOrErr.ok) {
    return c.json({ ok: false, error: zipOrErr.error }, zipOrErr.status);
  }
  const zipBuffer = zipOrErr.buffer;

  const dir = await unzipper.Open.buffer(zipBuffer);
  const manifestFile = dir.files.find((f) => {
    const p = f.path.replace(/\\/g, '/');
    return p === 'workflow.json' || p.endsWith('/workflow.json');
  });

  // Claude Design / HTML-only ZIP fallback (PLAN Task 10)
  if (!manifestFile) {
    const imported = await importClaudeDesignZip(dir);
    if (!imported) {
      return c.json({
        ok: false,
        error: 'workflow.json not found and no HTML entry (index.html) for Claude Design import',
      }, 400);
    }
    return c.json({ ok: true, data: imported.workflow, meta: { importKind: imported.importKind, artifactId: imported.artifactId } }, 201);
  }

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
  const finalName = existing ? `Copy of ${rawName}` : rawName;

  const created = db.createWorkflow({
    name: finalName,
    description: typeof wf.description === 'string' ? wf.description : undefined,
    domain: (['finance', 'coding', 'general'] as const).includes(wf.domain as never)
      ? (wf.domain as 'finance' | 'coding' | 'general')
      : 'general',
    nodes: (wf.nodes as never) ?? [],
    edges: (wf.edges as never) ?? [],
  });

  // Optional: restore artifact HTML files if present
  const artFiles = dir.files.filter((f) => {
    const p = f.path.replace(/\\/g, '/');
    return p.startsWith('artifacts/') && /\.(html?|md|txt)$/i.test(p) && !p.endsWith('.meta.json');
  });
  for (const f of artFiles) {
    const content = (await f.buffer()).toString('utf-8');
    const name = f.path.replace(/\\/g, '/').split('/').pop() ?? 'artifact';
    const contentType = /\.html?$/i.test(name) ? 'text/html' : /\.md$/i.test(name) ? 'text/markdown' : 'text/plain';
    artifactDb.createArtifact({
      workflowId: created.id,
      name,
      contentType,
      content,
    });
  }

  // Optional: restore design systems from design-systems/<name>/DESIGN.md (plan Tasks 1 / 10)
  let importedDesignSystemId: string | undefined =
    typeof wf.designSystemId === 'string' ? wf.designSystemId : undefined;
  const dsFiles = dir.files.filter((f) => {
    const p = f.path.replace(/\\/g, '/');
    return /^design-systems\/[^/]+\/DESIGN\.md$/i.test(p);
  });
  for (const f of dsFiles) {
    const p = f.path.replace(/\\/g, '/');
    const parts = p.split('/');
    const rawName = parts[1] ?? 'imported';
    // Directory names must match createDesignSystem allowlist
    const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'imported';
    const content = (await f.buffer()).toString('utf-8');
    let ds = await createDesignSystem(safeName, `Imported with ${finalName}`);
    if (!ds) {
      // already exists — overwrite content and re-bind id
      const { listDesignSystems } = await import('../lib/design-system-store.js');
      const existingDs = (await listDesignSystems()).find((d) => d.name === safeName);
      if (existingDs) {
        await updateDesignSystemContent(existingDs.id, content);
        ds = existingDs;
      }
    } else {
      await updateDesignSystemContent(ds.id, content);
    }
    if (ds) {
      importedDesignSystemId = ds.id;
    }
  }

  if (importedDesignSystemId) {
    db.updateWorkflow(created.id, { designSystemId: importedDesignSystemId });
  }

  const finalWf = db.getWorkflow(created.id) ?? created;
  return c.json({
    ok: true,
    data: finalWf,
    meta: {
      importKind: 'neos-workflow',
      designSystemId: importedDesignSystemId,
    },
  }, 201);
});

/** Dedicated Claude Design ZIP import (OD §18.1) */
workflow.post('/import/claude-design', async (c) => {
  const zipOrErr = await readZipBuffer(c);
  if (!zipOrErr.ok) {
    return c.json({ ok: false, error: zipOrErr.error }, zipOrErr.status);
  }
  const dir = await unzipper.Open.buffer(zipOrErr.buffer);
  const imported = await importClaudeDesignZip(dir);
  if (!imported) {
    return c.json({ ok: false, error: 'No HTML entry file found in ZIP' }, 400);
  }
  return c.json({
    ok: true,
    data: imported.workflow,
    meta: { importKind: imported.importKind, artifactId: imported.artifactId },
  }, 201);
});

// ── Runs ──────────────────────────────────────────────────

workflow.get('/:id/runs', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = Number(c.req.query('offset') ?? '0');
  const runs = db.listRuns(c.req.param('id'), limit, offset);
  return c.json({ ok: true, data: runs });
});

/** Clear runs for a workflow. Optional ?status=completed|failed|cancelled|running */
workflow.delete('/:id/runs', (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  const status = c.req.query('status') || undefined;
  const allowed = new Set(['completed', 'failed', 'cancelled', 'running']);
  if (status && !allowed.has(status)) {
    return c.json({ ok: false, error: 'Invalid status filter' }, 400);
  }
  const deleted = db.deleteRuns(wf.id, status);
  return c.json({ ok: true, data: { deleted } });
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

/**
 * Preflight checks — structural graph + settings readiness (plan polish).
 * Does not start a run.
 */
workflow.post('/:id/preflight', async (c) => {
  const wf = db.getWorkflow(c.req.param('id'));
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  const secrets = getExecutionSettings({
    serverUrl: getRuntimeServerUrl(),
    authToken: getRuntimeAuthToken(),
  });
  const result = assessWorkflowPreflight(
    { nodes: wf.nodes, edges: wf.edges },
    secrets,
  );
  return c.json({
    ok: true,
    data: result,
  });
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

  const settings = getExecutionSettings({
    serverUrl: getRuntimeServerUrl(),
    authToken: getRuntimeAuthToken(),
  });
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
          spawnCliAgent({
            cliId,
            prompt,
            onChunk,
            signal,
            workflowId: wf.id,
            runId,
            serverUrl: getRuntimeServerUrl(),
            authToken: getRuntimeAuthToken(),
          }),
        designSystemContent,
      });

      // Auto-detect HTML artifacts from completed node outputs (plan Task 4)
      const artifactId = createFirstHtmlArtifact({
        workflowId: wf.id,
        runId,
        nodeResults,
        create: (input) => artifactDb.createArtifact(input),
      });

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
