/**
 * Memory REST routes.
 * GET    /api/memory         — list all memories
 * POST   /api/memory         — create memory
 * GET    /api/memory/export  — export enabled memories as Markdown
 * GET    /api/memory/:id     — get single memory
 * PUT    /api/memory/:id     — update memory
 * DELETE /api/memory/:id     — delete memory
 * PUT    /api/memory/:id/toggle — toggle enabled/disabled
 */

import { Hono } from 'hono';
import type { CreateMemoryInput, UpdateMemoryInput } from '@neos-work/shared';
import {
  listMemories,
  getMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  toggleMemory,
  exportMemories,
} from '../lib/memory-store.js';

const memory = new Hono();

memory.get('/', (c) => {
  return c.json({ ok: true, data: listMemories() });
});

// Must be before /:id to avoid param collision
memory.get('/export', (c) => {
  const md = exportMemories();
  return c.text(md, 200, { 'Content-Type': 'text/markdown' });
});

memory.post('/', async (c) => {
  const body = await c.req.json<CreateMemoryInput>();
  if (!body.name || !body.type || !body.content) {
    return c.json({ ok: false, error: 'name, type, and content are required' }, 400);
  }
  const item = createMemory(body);
  return c.json({ ok: true, data: item }, 201);
});

memory.get('/:id', (c) => {
  const item = getMemory(c.req.param('id'));
  if (!item) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: item });
});

memory.put('/:id', async (c) => {
  const body = await c.req.json<UpdateMemoryInput>();
  const item = updateMemory(c.req.param('id'), body);
  if (!item) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: item });
});

memory.delete('/:id', (c) => {
  const ok = deleteMemory(c.req.param('id'));
  if (!ok) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

memory.put('/:id/toggle', (c) => {
  const item = toggleMemory(c.req.param('id'));
  if (!item) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: item });
});

export default memory;
