/**
 * Live Artifact user/UI routes (OD §17 / Task 9).
 *
 * GET    /api/live-artifacts?projectId=
 * POST   /api/live-artifacts
 * GET    /api/live-artifacts/:id?projectId=
 * PATCH  /api/live-artifacts/:id?projectId=
 * DELETE /api/live-artifacts/:id?projectId=
 * GET    /api/live-artifacts/:id/preview?projectId=
 * POST   /api/live-artifacts/:id/refresh?projectId=
 * GET    /api/live-artifacts/:id/refreshes?projectId=
 * POST   /api/projects/:projectId/tool-tokens  — issue tool token (mounted under projects too)
 */

import { Hono } from 'hono';
import {
  createLiveArtifact,
  deleteLiveArtifact,
  getLiveArtifact,
  listLiveArtifactRefreshes,
  listLiveArtifacts,
  refreshLiveArtifact,
  updateLiveArtifact,
} from '../db/live-artifacts.js';
import { getProject } from '../db/projects.js';
import { publicErrorMessage } from '../lib/errors.js';
import { safeRouteId } from '../lib/path-safety.js';
import { issueToolToken, ToolTokenError } from '../lib/tool-tokens.js';

const liveArtifacts = new Hono();

function projectIdFrom(c: {
  req: { query: (k: string) => string | undefined; json: <T>() => Promise<T> };
}): string {
  const q = c.req.query('projectId') ?? '';
  return safeRouteId(q);
}

liveArtifacts.get('/', (c) => {
  const projectId = projectIdFrom(c);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  if (!getProject(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
  return c.json({ ok: true, data: listLiveArtifacts(projectId) });
});

/**
 * Issue a project-scoped tool token (used by agents for /api/tools/*).
 * Registered before /:id so "tool-tokens" is not captured as an id.
 */
liveArtifacts.post('/tool-tokens', async (c) => {
  const projectId = projectIdFrom(c);
  const raw = await c.req.json().catch(() => null);
  const body =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const pid =
    projectId
    || safeRouteId(typeof body.projectId === 'string' ? body.projectId : '');
  if (!pid) return c.json({ ok: false, error: 'projectId is required' }, 400);
  if (!getProject(pid)) return c.json({ ok: false, error: 'Project not found' }, 404);
  try {
    const caps = Array.isArray(body.capabilities)
      ? (body.capabilities as string[])
      : ['live-artifacts'];
    const issued = issueToolToken({
      projectId: pid,
      runId: typeof body.runId === 'string' ? body.runId : null,
      capabilities: caps,
      ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
    });
    return c.json({ ok: true, data: issued }, 201);
  } catch (err) {
    if (err instanceof ToolTokenError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid token request') }, 400);
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to issue tool token') }, 400);
  }
});

liveArtifacts.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const projectId = safeRouteId(typeof body.projectId === 'string' ? body.projectId : '');
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  if (!getProject(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
  try {
    const art = createLiveArtifact({
      projectId,
      name: typeof body.name === 'string' ? body.name : '',
      sourceTemplate:
        body.sourceTemplate === null
          ? null
          : typeof body.sourceTemplate === 'string'
            ? body.sourceTemplate
            : undefined,
      inputs:
        body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
          ? (body.inputs as Record<string, unknown>)
          : undefined,
      contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
      writeSidecar: body.writeSidecar !== false,
    });
    return c.json({ ok: true, data: art }, 201);
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to create live artifact') }, 400);
  }
});

liveArtifacts.get('/:id', (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  const art = getLiveArtifact(id, projectId);
  if (!art) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: art });
});

liveArtifacts.get('/:id/preview', (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  const art = getLiveArtifact(id, projectId);
  if (!art) return c.json({ ok: false, error: 'Not found' }, 404);
  const html = art.content ?? '';
  c.header('Content-Type', art.contentType || 'text/html; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(html);
});

liveArtifacts.get('/:id/refreshes', (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  if (!getLiveArtifact(id, projectId)) return c.json({ ok: false, error: 'Not found' }, 404);
  const limitRaw = c.req.query('limit') ?? '';
  const limit =
    limitRaw && !/[\0\r\n]/.test(limitRaw) ? Math.min(Math.max(Number(limitRaw) || 20, 1), 100) : 20;
  return c.json({ ok: true, data: listLiveArtifactRefreshes(id, limit) });
});

liveArtifacts.patch('/:id', async (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  try {
    const updated = updateLiveArtifact(id, projectId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      sourceTemplate:
        body.sourceTemplate === null
          ? null
          : typeof body.sourceTemplate === 'string'
            ? body.sourceTemplate
            : undefined,
      inputs:
        body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
          ? (body.inputs as Record<string, unknown>)
          : undefined,
      contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
    });
    if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
    return c.json({ ok: true, data: updated });
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to update') }, 400);
  }
});

liveArtifacts.delete('/:id', (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  const ok = deleteLiveArtifact(id, projectId);
  if (!ok) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

liveArtifacts.post('/:id/refresh', async (c) => {
  const id = safeRouteId(c.req.param('id'));
  const projectId = projectIdFrom(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!projectId) return c.json({ ok: false, error: 'projectId is required' }, 400);
  const raw = await c.req.json().catch(() => null);
  const body =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  try {
    const inputs =
      body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
        ? (body.inputs as Record<string, unknown>)
        : undefined;
    const result = refreshLiveArtifact(id, projectId, inputs);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Refresh failed');
    const status = /not found/i.test(msg) ? 404 : 400;
    return c.json({ ok: false, error: msg }, status);
  }
});

export default liveArtifacts;
