/**
 * Agent tool-token routes for live artifacts (OD §17 / Task 9).
 *
 * Auth: Bearer <tool-token> (not the daemon AUTH_TOKEN).
 * projectId is derived from the token; body projectId/runId override → 403.
 *
 * POST /api/tools/live-artifacts/create
 * GET  /api/tools/live-artifacts/list
 * POST /api/tools/live-artifacts/update
 * POST /api/tools/live-artifacts/refresh
 */

import { Hono } from 'hono';
import {
  createLiveArtifact,
  getLiveArtifact,
  listLiveArtifacts,
  refreshLiveArtifact,
  updateLiveArtifact,
} from '../db/live-artifacts.js';
import { publicErrorMessage } from '../lib/errors.js';
import { safeRouteId } from '../lib/path-safety.js';
import {
  assertNoScopeOverride,
  extractBearerToken,
  requireToolCapability,
  resolveToolToken,
  ToolTokenError,
  type ToolTokenRecord,
} from '../lib/tool-tokens.js';

const tools = new Hono();

function authTool(c: { req: { header: (k: string) => string | undefined } }): ToolTokenRecord {
  const token = extractBearerToken(c.req.header('Authorization'));
  const rec = resolveToolToken(token);
  requireToolCapability(rec, 'live-artifacts');
  return rec;
}

function toolError(err: unknown): { status: 401 | 403 | 400 | 404 | 500; body: { ok: false; error: string } } {
  if (err instanceof ToolTokenError) {
    const status =
      err.code === 'override' || err.code === 'capability' ? 403
        : err.code === 'expired' || err.code === 'invalid' ? 401
          : 400;
    return { status, body: { ok: false, error: publicErrorMessage(err, 'Tool auth failed') } };
  }
  const msg = publicErrorMessage(err, 'Request failed');
  const status = /not found/i.test(msg) ? 404 : 400;
  return { status, body: { ok: false, error: msg } };
}

tools.post('/create', async (c) => {
  try {
    const rec = authTool(c);
    const raw = await c.req.json().catch(() => null);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    assertNoScopeOverride(rec, body);
    const art = createLiveArtifact({
      projectId: rec.projectId,
      name: typeof body.name === 'string' ? body.name : 'Live artifact',
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
    return c.json({ ok: true, data: art }, 201);
  } catch (err) {
    const e = toolError(err);
    return c.json(e.body, e.status);
  }
});

tools.get('/list', (c) => {
  try {
    const rec = authTool(c);
    // Reject query override of projectId
    const qPid = c.req.query('projectId');
    if (qPid != null && qPid !== '') {
      assertNoScopeOverride(rec, { projectId: qPid });
    }
    return c.json({ ok: true, data: listLiveArtifacts(rec.projectId) });
  } catch (err) {
    const e = toolError(err);
    return c.json(e.body, e.status);
  }
});

tools.post('/update', async (c) => {
  try {
    const rec = authTool(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    assertNoScopeOverride(rec, body);
    const id = safeRouteId(typeof body.id === 'string' ? body.id : typeof body.artifactId === 'string' ? body.artifactId : '');
    if (!id) return c.json({ ok: false, error: 'id is required' }, 400);
    const updated = updateLiveArtifact(id, rec.projectId, {
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
    const e = toolError(err);
    return c.json(e.body, e.status);
  }
});

tools.post('/refresh', async (c) => {
  try {
    const rec = authTool(c);
    const raw = await c.req.json().catch(() => null);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    assertNoScopeOverride(rec, body);
    const id = safeRouteId(
      typeof body.id === 'string'
        ? body.id
        : typeof body.artifactId === 'string'
          ? body.artifactId
          : '',
    );
    if (!id) return c.json({ ok: false, error: 'id is required' }, 400);
    if (!getLiveArtifact(id, rec.projectId)) {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
    const inputs =
      body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
        ? (body.inputs as Record<string, unknown>)
        : undefined;
    const result = refreshLiveArtifact(id, rec.projectId, inputs);
    return c.json({ ok: true, data: result });
  } catch (err) {
    const e = toolError(err);
    return c.json(e.body, e.status);
  }
});

export default tools;
