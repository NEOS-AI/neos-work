/**
 * Design Systems routes.
 * GET    /api/design-systems          — list
 * POST   /api/design-systems          — create
 * GET    /api/design-systems/:id      — get
 * DELETE /api/design-systems/:id      — delete
 * GET    /api/design-systems/:id/content  — DESIGN.md raw text
 * PUT    /api/design-systems/:id/content  — save DESIGN.md
 */

import { Hono } from 'hono';
import * as store from '../lib/design-system-store.js';

const designSystems = new Hono();

designSystems.get('/', async (c) => {
  const list = await store.listDesignSystems();
  return c.json({ ok: true, data: list });
});

designSystems.post('/', async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body?.description === 'string' ? body.description.trim() || undefined : undefined;
  if (!name) {
    return c.json({ ok: false, error: 'name is required (alphanumeric, - and _ only)' }, 400);
  }
  const ds = await store.createDesignSystem(name, description);
  if (!ds) {
    return c.json({ ok: false, error: 'Name must be alphanumeric (- and _ allowed) and must not already exist' }, 409);
  }
  return c.json({ ok: true, data: ds }, 201);
});

designSystems.get('/:id', async (c) => {
  const ds = await store.getDesignSystem(c.req.param('id'));
  if (!ds) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: ds });
});

designSystems.delete('/:id', async (c) => {
  const deleted = await store.deleteDesignSystem(c.req.param('id'));
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

designSystems.get('/:id/content', async (c) => {
  const content = await store.getDesignSystemContent(c.req.param('id'));
  if (content === null) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: { content } });
});

designSystems.put('/:id/content', async (c) => {
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  // Reject pure-whitespace so getDesignSystemContent does not treat it as missing later
  if (!body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be empty' }, 400);
  }
  const updated = await store.updateDesignSystemContent(c.req.param('id'), body.content);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default designSystems;
