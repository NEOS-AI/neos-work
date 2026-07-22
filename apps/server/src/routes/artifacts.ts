/**
 * Artifacts routes.
 * GET  /api/artifacts?workflowId=...   — list by workflow
 * GET  /api/artifacts?runId=...        — list by run
 * GET  /api/artifacts/:id              — get single (returns full content)
 * GET  /api/artifacts/:id/preview      — raw HTML/text preview
 * POST /api/artifacts                  — create
 * PUT  /api/artifacts/:id              — update content
 * PATCH /api/artifacts/:id            — update name and/or content (plan Task 4)
 * DELETE /api/artifacts/:id            — delete
 */

import { Hono } from 'hono';
import * as db from '../db/artifacts.js';

const artifacts = new Hono();

artifacts.get('/', (c) => {
  const workflowId = (c.req.query('workflowId') ?? '').trim();
  const runId = (c.req.query('runId') ?? '').trim();

  if (runId) {
    return c.json({ ok: true, data: db.listArtifactsByRun(runId) });
  }
  if (workflowId) {
    return c.json({ ok: true, data: db.listArtifacts(workflowId) });
  }
  return c.json({ ok: false, error: 'workflowId or runId query param required' }, 400);
});

artifacts.get('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const artifact = db.getArtifact(id);
  if (!artifact) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: artifact });
});

/**
 * Live Artifact preview endpoint (plan Task 4).
 * Returns raw HTML (or text) for iframe / srcDoc consumers.
 */
artifacts.get('/:id/preview', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const artifact = db.getArtifact(id);
  if (!artifact) return c.json({ ok: false, error: 'Not found' }, 404);
  const content = artifact.content ?? '';
  const isHtml = (artifact.contentType ?? '').includes('html');
  c.header('Content-Type', isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  // Deny framing from other origins if ever loaded as a document
  c.header('Content-Security-Policy', "frame-ancestors 'self'");
  return c.body(content);
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

  const workflowId = typeof body?.workflowId === 'string' ? body.workflowId.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const contentType = typeof body?.contentType === 'string' ? body.contentType.trim() : '';
  if (!workflowId || !name || !contentType) {
    return c.json({ ok: false, error: 'workflowId, name, contentType required' }, 400);
  }
  if (name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  // Allow empty content; reject pure-whitespace accidental paste
  if (typeof body?.content === 'string' && body.content.length > 0 && !body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be whitespace-only' }, 400);
  }

  const artifact = db.createArtifact({
    workflowId,
    runId: typeof body?.runId === 'string' ? body.runId.trim() || undefined : body?.runId,
    name,
    contentType,
    content: body?.content,
    nodeId: typeof body?.nodeId === 'string' ? body.nodeId.trim() || undefined : body?.nodeId,
  });
  return c.json({ ok: true, data: artifact }, 201);
});

artifacts.put('/:id', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  // Allow empty content (clear), but not pure-whitespace-as-accidental
  if (body.content.length > 0 && !body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be whitespace-only' }, 400);
  }
  const updated = db.updateArtifactContent(id, body.content);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: updated });
});

/** Plan Task 4 — PATCH name and/or content */
artifacts.patch('/:id', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ name?: string; content?: string }>().catch(() => null);
  if (!body || (body.name === undefined && body.content === undefined)) {
    return c.json({ ok: false, error: 'name and/or content required' }, 400);
  }
  let name: string | undefined;
  if (body.name !== undefined) {
    name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return c.json({ ok: false, error: 'content must be a string' }, 400);
    }
    if (body.content.length > 0 && !body.content.trim()) {
      return c.json({ ok: false, error: 'content cannot be whitespace-only' }, 400);
    }
  }
  const updated = db.updateArtifact(id, {
    name,
    content: body.content,
  });
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: updated });
});

artifacts.delete('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const deleted = db.deleteArtifact(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

/**
 * Refresh artifact content for preview.
 * Body: { mode?: 'reload' | 'rerun' }
 * - reload (default): re-read file_path or return stored content
 * - rerun: instruct client/server to re-run the parent workflow (returns workflowId)
 */
artifacts.post('/:id/refresh', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const artifact = db.getArtifact(id);
  if (!artifact) return c.json({ ok: false, error: 'Not found' }, 404);

  const body = await c.req.json<{ mode?: 'reload' | 'rerun' }>().catch(() => ({} as { mode?: string }));
  const rawMode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
  const mode = rawMode === 'rerun' ? 'rerun' : 'reload';

  if (mode === 'rerun') {
    // Client should call POST /api/workflow/:workflowId/run and listen for new artifacts
    return c.json({
      ok: true,
      data: artifact,
      meta: {
        mode: 'rerun',
        workflowId: artifact.workflowId,
        nodeId: artifact.nodeId,
        message: 'Re-run the workflow to regenerate this artifact',
      },
    });
  }

  if (artifact.filePath) {
    try {
      const fs = await import('node:fs/promises');
      const pathMod = await import('node:path');
      // Only allow reading under home config / media dirs (path traversal defense)
      const resolved = pathMod.resolve(artifact.filePath);
      const home = (await import('node:os')).homedir();
      if (!resolved.startsWith(pathMod.resolve(home))) {
        return c.json({ ok: false, error: 'Invalid file path' }, 400);
      }
      const content = await fs.readFile(resolved, 'utf8');
      const updated = db.updateArtifactContent(id, content);
      return c.json({ ok: true, data: updated, meta: { mode: 'reload' } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to refresh file';
      return c.json({ ok: false, error: msg }, 500);
    }
  }

  // No file — return current in-DB content (client reloads preview)
  return c.json({ ok: true, data: artifact, meta: { mode: 'reload' } });
});

export default artifacts;
