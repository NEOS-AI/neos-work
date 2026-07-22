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
import { listHarnesses, resolveHarness } from '@neos-work/workflow-engine';
import * as db from '../db/harnesses.js';
import { registerHarness } from '@neos-work/workflow-engine';

const harness = new Hono();

harness.get('/', (c) => {
  const all = listHarnesses();
  const custom = db.listCustomHarnesses();

  // Merge: custom harnesses may override built-in IDs (shouldn't normally happen)
  const map = new Map(all.map((h) => [h.id, h]));
  for (const h of custom) map.set(h.id, h);

  return c.json({ ok: true, data: [...map.values()] });
});

harness.get('/:id', (c) => {
  const id = c.req.param('id');
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
  }>();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  if (!name || !systemPrompt) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }

  if (!Array.isArray(body.allowedTools)) {
    return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : (body.description ?? '');
  const domain =
    typeof body.domain === 'string' ? body.domain.trim() || 'general' : (body.domain ?? 'general');

  const newHarness = db.createCustomHarness({
    id: nanoid(12),
    name,
    domain: domain as never,
    description,
    systemPrompt,
    allowedTools: body.allowedTools,
    constraints: body.constraints,
  });

  // Register in runtime harness registry
  registerHarness(newHarness);

  return c.json({ ok: true, data: newHarness }, 201);
});

harness.put('/:id', async (c) => {
  const id = c.req.param('id');

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
  }>>();

  const patch: Record<string, unknown> = { ...body };
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
    patch.name = name;
  }
  if (body.systemPrompt !== undefined) {
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    if (!systemPrompt) return c.json({ ok: false, error: 'systemPrompt is required' }, 400);
    patch.systemPrompt = systemPrompt;
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.trim();
  }
  if (typeof body.domain === 'string') {
    patch.domain = body.domain.trim() || 'general';
  }

  const updated = db.updateCustomHarness(id, patch as never);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);

  // Sync to runtime registry
  registerHarness(updated);

  return c.json({ ok: true, data: updated });
});

harness.delete('/:id', (c) => {
  const id = c.req.param('id');

  if (resolveHarness(id)?.isBuiltIn) {
    return c.json({ ok: false, error: 'Cannot delete built-in harness' }, 403);
  }

  const deleted = db.deleteCustomHarness(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);

  return c.json({ ok: true });
});

export default harness;
