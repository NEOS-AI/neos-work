/**
 * Block REST routes:
 *   GET    /api/blocks         — list all blocks (built-in + custom), optional ?domain=
 *   POST   /api/blocks         — create a custom block
 *   GET    /api/blocks/:id     — get a single block
 *   PUT    /api/blocks/:id     — update a custom block
 *   DELETE /api/blocks/:id     — delete a custom block
 */

import { Hono } from 'hono';
import { listBlocks, getNativeExecutor, registerNativeBlock } from '@neos-work/workflow-engine';
import { listCustomBlocks, getCustomBlock, createCustomBlock, updateCustomBlock, deleteCustomBlock } from '../db/blocks.js';
import type { WorkflowBlock } from '@neos-work/shared';

const blocks = new Hono();

// GET /api/blocks
blocks.get('/', (c) => {
  const domainRaw = (c.req.query('domain') ?? '').trim().toLowerCase();
  const domain = domainRaw || undefined;
  const builtIn = listBlocks(domain);
  const custom = listCustomBlocks(domain);
  return c.json({ ok: true, data: [...builtIn, ...custom] });
});

// POST /api/blocks
blocks.post('/', async (c) => {
  const body = await c.req.json<Omit<WorkflowBlock, 'isBuiltIn'>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!id || !name) {
    return c.json({ ok: false, error: 'id and name are required' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return c.json({ ok: false, error: 'id must be alphanumeric (- and _ allowed)' }, 400);
  }
  if (!['native', 'prompt', 'skill'].includes(body.implementationType)) {
    return c.json({ ok: false, error: 'implementationType must be native | prompt | skill' }, 400);
  }
  const promptTemplate =
    typeof body.promptTemplate === 'string' ? body.promptTemplate.trim() : body.promptTemplate;
  if (body.implementationType === 'prompt' && !promptTemplate) {
    return c.json({ ok: false, error: 'promptTemplate is required for prompt blocks' }, 400);
  }

  const domainRaw =
    typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as WorkflowBlock['domain'])
    : 'general';

  const block = createCustomBlock({
    ...body,
    id,
    name,
    promptTemplate,
    paramDefs: body.paramDefs ?? [],
    inputDescription: body.inputDescription ?? '',
    outputDescription: body.outputDescription ?? '',
    category: (typeof body.category === 'string' ? body.category.trim() : '') || 'custom',
    domain,
    description: typeof body.description === 'string' ? body.description.trim() : (body.description ?? ''),
  });

  // If native, register an executor shim that returns a stub (real execution needs server restart)
  if (block.implementationType === 'native' && !getNativeExecutor(block.id)) {
    registerNativeBlock({
      blockId: block.id,
      execute: async () => ({ ok: false, output: null, error: 'No native executor registered for custom block', durationMs: 0 }),
    });
  }

  return c.json({ ok: true, data: block }, 201);
});

// GET /api/blocks/:id
blocks.get('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Block not found' }, 404);
  const builtInMeta = listBlocks().find((b) => b.id === id);
  if (builtInMeta) return c.json({ ok: true, data: builtInMeta });

  const block = getCustomBlock(id);
  if (!block) return c.json({ ok: false, error: 'Block not found' }, 404);
  return c.json({ ok: true, data: block });
});

// PUT /api/blocks/:id
blocks.put('/:id', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  const body = await c.req.json<Partial<WorkflowBlock>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const patch: Partial<WorkflowBlock> = { ...body };
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ ok: false, error: 'name cannot be empty' }, 400);
    patch.name = name;
  }
  if (typeof body.domain === 'string') {
    const domainRaw = body.domain.trim().toLowerCase() || 'general';
    patch.domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
      ? (domainRaw as WorkflowBlock['domain'])
      : 'general';
  }
  if (typeof body.category === 'string') {
    patch.category = body.category.trim() || 'custom';
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.trim();
  }
  if (typeof body.promptTemplate === 'string') {
    patch.promptTemplate = body.promptTemplate.trim();
  }
  if (typeof body.inputDescription === 'string') {
    patch.inputDescription = body.inputDescription.trim();
  }
  if (typeof body.outputDescription === 'string') {
    patch.outputDescription = body.outputDescription.trim();
  }

  const updated = updateCustomBlock(id, patch);
  if (!updated) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true, data: updated });
});

// DELETE /api/blocks/:id
blocks.delete('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  const deleted = deleteCustomBlock(id);
  if (!deleted) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true });
});

export default blocks;
