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

  if (!body.name || !body.systemPrompt) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }

  if (!Array.isArray(body.allowedTools)) {
    return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
  }

  const newHarness = db.createCustomHarness({
    id: nanoid(12),
    name: body.name,
    domain: (body.domain ?? 'general') as never,
    description: body.description ?? '',
    systemPrompt: body.systemPrompt,
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

  const updated = db.updateCustomHarness(id, body as never);
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
