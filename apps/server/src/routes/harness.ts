/**
 * Harness REST routes.
 * GET    /api/harness        — list all harnesses (built-in + custom)
 * GET    /api/harness/:id    — get a harness
 * POST   /api/harness        — create custom harness
 * PUT    /api/harness/:id    — update custom harness (built-in: 403)
 * DELETE /api/harness/:id    — delete custom harness (built-in: 403)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  listHarnesses,
  resolveHarness,
  registerHarness,
  unregisterHarness,
} from '@neos-work/workflow-engine';
import * as db from '../db/workers.js';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';

const harness = new Hono();

/** v0.4.x deprecation alias for /api/workers (BC-4). */
harness.use('*', async (c, next) => {
  c.header('Deprecation', 'true');
  c.header('Link', '</api/workers>; rel="successor-version"');
  c.header('X-Neos-Deprecated', 'Use /api/workers instead of /api/harness');
  await next();
});


function paramHarnessId(c: { req: { param: (k: string) => string } }): string {
  return safeRouteId(c.req.param('id'));
}

/** Clamp harness constraints to agent editor bounds (maxSteps 1–200). */
function normalizeConstraints(
  raw: { maxSteps?: number; maxTokens?: number; timeoutMs?: number } | undefined,
): { maxSteps?: number; maxTokens?: number; timeoutMs?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: { maxSteps?: number; maxTokens?: number; timeoutMs?: number } = {};
  if (raw.maxSteps !== undefined) {
    const n = Number(raw.maxSteps);
    if (Number.isFinite(n) && n >= 1) {
      out.maxSteps = Math.min(200, Math.floor(n));
    }
  }
  if (raw.maxTokens !== undefined) {
    const n = Number(raw.maxTokens);
    if (Number.isFinite(n) && n >= 1) {
      out.maxTokens = Math.min(1_000_000, Math.floor(n));
    }
  }
  if (raw.timeoutMs !== undefined) {
    const n = Number(raw.timeoutMs);
    if (Number.isFinite(n) && n >= 1) {
      out.timeoutMs = Math.min(3_600_000, Math.floor(n));
    }
  }
  return out;
}

function normalizeAllowedTools(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((t) => {
      const s = typeof t === 'string' ? t : String(t ?? '');
      // Control-char check before trim
      if (/[\0\r\n]/.test(s)) return '';
      return s.trim();
    })
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, 100);
}

harness.get('/', (c) => {
  const all = listHarnesses();
  const custom = db.listCustomHarnesses();

  // Merge: custom harnesses may override built-in IDs (shouldn't normally happen)
  const map = new Map(all.map((h) => [h.id, h]));
  for (const h of custom) map.set(h.id, h);

  return c.json({ ok: true, data: [...map.values()] });
});

harness.get('/:id', (c) => {
  const id = paramHarnessId(c);
  if (!id) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  const builtin = resolveHarness(id);
  if (builtin) return c.json({ ok: true, data: builtin });

  const custom = db.getCustomHarness(id);
  if (!custom) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: custom });
});

harness.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    domain: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    constraints?: { maxSteps?: number; maxTokens?: number; timeoutMs?: number };
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (typeof body.systemPrompt !== 'string' || /\0/.test(body.systemPrompt)) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }
  const name = body.name.trim();
  const systemPrompt = body.systemPrompt.trim();
  if (!name || !systemPrompt) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }
  if (name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  if (!Array.isArray(body.allowedTools)) {
    return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
  }
  const allowedTools = normalizeAllowedTools(body.allowedTools) ?? [];

  let description = '';
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    description = body.description.trim();
  }
  const domainRaw =
    typeof body.domain === 'string' && !/[\0\r\n]/.test(body.domain)
      ? body.domain.trim().toLowerCase() || 'general'
      : 'general';
  const domain = (['finance', 'coding', 'research', 'general'] as const).includes(domainRaw as never)
    ? domainRaw
    : 'general';

  try {
    const newHarness = db.createCustomHarness({
      id: nanoid(12),
      name,
      domain: domain as never,
      description,
      systemPrompt,
      allowedTools,
      constraints: normalizeConstraints(body.constraints),
    });

    // Register in runtime harness registry
    registerHarness(newHarness);

    return c.json({ ok: true, data: newHarness }, 201);
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to create harness');
    return c.json({ ok: false, error: msg }, 400);
  }
});

harness.put('/:id', async (c) => {
  const id = paramHarnessId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);

  // Block editing of built-in harnesses
  if (resolveHarness(id)?.isBuiltIn) {
    return c.json({ ok: false, error: 'Cannot modify built-in harness' }, 403);
  }

  const body = await c.req.json<Partial<{
    name: string;
    domain: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    constraints: object;
  }>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const patch: Record<string, unknown> = { ...body };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    const name = body.name.trim();
    if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
    if (name.length > 200) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    patch.name = name;
  }
  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== 'string' || /\0/.test(body.systemPrompt)) {
      return c.json({ ok: false, error: 'systemPrompt is required' }, 400);
    }
    const systemPrompt = body.systemPrompt.trim();
    if (!systemPrompt) return c.json({ ok: false, error: 'systemPrompt is required' }, 400);
    patch.systemPrompt = systemPrompt;
  }
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    patch.description = body.description.trim();
  }
  if (typeof body.domain === 'string') {
    const domainRaw = !/[\0\r\n]/.test(body.domain)
      ? body.domain.trim().toLowerCase() || 'general'
      : 'general';
    patch.domain = (['finance', 'coding', 'research', 'general'] as const).includes(domainRaw as never)
      ? domainRaw
      : 'general';
  }
  if (body.allowedTools !== undefined) {
    if (!Array.isArray(body.allowedTools)) {
      return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
    }
    patch.allowedTools = normalizeAllowedTools(body.allowedTools) ?? [];
  }
  if (body.constraints !== undefined) {
    patch.constraints = normalizeConstraints(
      body.constraints as { maxSteps?: number; maxTokens?: number; timeoutMs?: number },
    );
  }

  const updated = db.updateCustomHarness(id, patch as never);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);

  // Sync to runtime registry
  registerHarness(updated);

  return c.json({ ok: true, data: updated });
});

harness.delete('/:id', (c) => {
  const id = paramHarnessId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);

  if (resolveHarness(id)?.isBuiltIn) {
    return c.json({ ok: false, error: 'Cannot delete built-in harness' }, 403);
  }

  const deleted = db.deleteCustomHarness(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  // Sync runtime registry (alias of unregisterWorker)
  unregisterHarness(id);

  return c.json({ ok: true });
});

export default harness;
