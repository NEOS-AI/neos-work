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
  const domain = c.req.query('domain');
  const builtIn = listBlocks(domain);
  const custom = listCustomBlocks(domain);
  return c.json({ ok: true, data: [...builtIn, ...custom] });
});

// POST /api/blocks
blocks.post('/', async (c) => {
  const body = await c.req.json<Omit<WorkflowBlock, 'isBuiltIn'>>();
  if (!body.id || !body.name) {
    return c.json({ ok: false, error: 'id and name are required' }, 400);
  }
  if (!['native', 'prompt', 'skill'].includes(body.implementationType)) {
    return c.json({ ok: false, error: 'implementationType must be native | prompt | skill' }, 400);
  }
  if (body.implementationType === 'prompt' && !body.promptTemplate) {
    return c.json({ ok: false, error: 'promptTemplate is required for prompt blocks' }, 400);
  }

  const block = createCustomBlock({
    ...body,
    paramDefs: body.paramDefs ?? [],
    inputDescription: body.inputDescription ?? '',
    outputDescription: body.outputDescription ?? '',
    category: body.category ?? 'custom',
    domain: body.domain ?? 'general',
    description: body.description ?? '',
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
  const { id } = c.req.param();
  const builtInMeta = listBlocks().find((b) => b.id === id);
  if (builtInMeta) return c.json({ ok: true, data: builtInMeta });

  const block = getCustomBlock(id);
  if (!block) return c.json({ ok: false, error: 'Block not found' }, 404);
  return c.json({ ok: true, data: block });
});

// PUT /api/blocks/:id
blocks.put('/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<Partial<WorkflowBlock>>();

  const updated = updateCustomBlock(id, body);
  if (!updated) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true, data: updated });
});

// DELETE /api/blocks/:id
blocks.delete('/:id', (c) => {
  const { id } = c.req.param();
  const deleted = deleteCustomBlock(id);
  if (!deleted) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true });
});

export default blocks;
