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
import type { CreateMemoryInput, MemoryType, UpdateMemoryInput } from '@neos-work/shared';
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

const MEMORY_TYPES = new Set<MemoryType>(['user', 'session', 'skill', 'reference']);

function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase() as MemoryType;
  return MEMORY_TYPES.has(t) ? t : undefined;
}

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
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const type = parseMemoryType(body.type);
  if (!name || !type || !content) {
    return c.json({ ok: false, error: 'name, type, and content are required' }, 400);
  }
  const item = createMemory({
    name,
    type,
    content,
    enabled: body.enabled,
  });
  return c.json({ ok: true, data: item }, 201);
});

memory.get('/:id', (c) => {
  const item = getMemory(c.req.param('id'));
  if (!item) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: item });
});

memory.put('/:id', async (c) => {
  const body = await c.req.json<UpdateMemoryInput>();
  const patch: UpdateMemoryInput = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ ok: false, error: 'name cannot be empty' }, 400);
    patch.name = name;
  }
  if (body.content !== undefined) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ ok: false, error: 'content cannot be empty' }, 400);
    patch.content = content;
  }
  if (body.type !== undefined) {
    const type = parseMemoryType(body.type);
    if (!type) return c.json({ ok: false, error: 'invalid memory type' }, 400);
    patch.type = type;
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled;

  const item = updateMemory(c.req.param('id'), patch);
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
