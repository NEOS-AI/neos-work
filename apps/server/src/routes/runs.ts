/**
 * Project / agent run registry API (v0.5 Task 3 foundation).
 *
 * POST   /api/runs              — create + optionally start
 * GET    /api/runs              — list (?projectId=)
 * GET    /api/runs/:id          — get run
 * GET    /api/runs/:id/events   — events (?after=eventId)
 * POST   /api/runs/:id/cancel   — cancel
 *
 * Execution of BYOK/CLI is wired incrementally; create records + cancel work now.
 */

import { Hono } from 'hono';
import {
  assembleEditContextPrompt,
  getDefById,
  getGlobalRunRegistry,
} from '@neos-work/agent-runtime';
import { normalizeEditContext } from '@neos-work/shared';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';
import { getProject } from '../db/projects.js';

const runs = new Hono();

function paramId(c: { req: { param: (k: string) => string } }, key = 'id'): string {
  return safeRouteId(c.req.param(key));
}

function publicRun(record: {
  id: string;
  status: string;
  agentId?: string | null;
  projectId?: string | null;
  prompt?: string;
  editContext?: unknown;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  events: unknown[];
}) {
  return {
    id: record.id,
    status: record.status,
    agentId: record.agentId ?? null,
    projectId: record.projectId ?? null,
    prompt: record.prompt,
    editContext: record.editContext ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    eventCount: record.events.length,
  };
}

runs.get('/', (c) => {
  const projectId = safeRouteId(c.req.query('projectId') ?? '') || undefined;
  const reg = getGlobalRunRegistry();
  const list = reg.list(projectId ? { projectId } : undefined).map(publicRun);
  return c.json({ ok: true, data: list });
});

runs.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const projectId =
    typeof body.projectId === 'string' ? safeRouteId(body.projectId) : '';
  if (projectId && !getProject(projectId)) {
    return c.json({ ok: false, error: 'Project not found' }, 404);
  }

  const agentId =
    typeof body.agentId === 'string' && !/[\0\r\n]/.test(body.agentId)
      ? body.agentId.trim()
      : null;
  if (agentId && !getDefById(agentId)) {
    return c.json({ ok: false, error: 'Unknown agentId' }, 400);
  }

  const promptRaw = typeof body.prompt === 'string' ? body.prompt : '';
  if (/\0/.test(promptRaw)) {
    return c.json({ ok: false, error: 'Invalid prompt' }, 400);
  }

  const editContext = normalizeEditContext(body.editContext);
  if (body.editContext != null && !editContext) {
    return c.json({ ok: false, error: 'Invalid editContext' }, 400);
  }

  const { prompt: assembled } = assembleEditContextPrompt(promptRaw, editContext);

  const reg = getGlobalRunRegistry();
  const run = reg.create({
    projectId: projectId || null,
    agentId,
    prompt: assembled,
    editContext: editContext ?? undefined,
  });

  // Immediate start marker — full spawn/BYOK lands in later slices
  reg.setStatus(run.id, 'running');
  reg.appendEvent(run.id, 'run.started', {
    agentId,
    projectId: projectId || null,
    hasEditContext: !!editContext,
  });

  // Dry-run mode: mark succeeded with assembled prompt length (no process spawn yet)
  const dryRun = body.dryRun === true || body.execute === false;
  if (dryRun || !agentId) {
    reg.appendEvent(run.id, 'run.progress', {
      message: dryRun || !agentId
        ? 'Run recorded (execution deferred — use agentId + execute without dryRun when spawn is enabled)'
        : undefined,
      promptChars: assembled.length,
    });
    reg.setStatus(run.id, 'succeeded');
    reg.appendEvent(run.id, 'run.succeeded', { deferred: true });
  }

  return c.json({ ok: true, data: publicRun(reg.get(run.id)!) }, 201);
});

runs.get('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const run = getGlobalRunRegistry().get(id);
  if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: publicRun(run) });
});

runs.get('/:id/events', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const reg = getGlobalRunRegistry();
  if (!reg.get(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const after = safeRouteId(c.req.query('after') ?? '') || undefined;
  const events = reg.eventsAfter(id, after);
  return c.json({ ok: true, data: events });
});

runs.post('/:id/cancel', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const reg = getGlobalRunRegistry();
  if (!reg.get(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const ok = reg.cancel(id);
  if (!ok) {
    return c.json({ ok: false, error: 'Run already terminal' }, 409);
  }
  return c.json({ ok: true, data: publicRun(reg.get(id)!) });
});

export default runs;
export { runs };
