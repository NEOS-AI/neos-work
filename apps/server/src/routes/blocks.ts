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
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';

const blocks = new Hono();

/** Block ids: alphanumeric + _- (also reject control-char / overlong). */
function paramBlockId(c: { req: { param: (k: string) => string } }): string {
  const id = safeRouteId(c.req.param('id'), 200);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return '';
  return id;
}

// GET /api/blocks
blocks.get('/', (c) => {
  const domainQuery = c.req.query('domain') ?? '';
  // Control-char domain filter is ignored (list all / unfiltered)
  const domainRaw =
    domainQuery && !/[\0\r\n]/.test(domainQuery)
      ? domainQuery.trim().toLowerCase()
      : '';
  // Only known domains filter; unknown → list all (align with templates)
  const domain =
    domainRaw === 'finance' || domainRaw === 'coding' || domainRaw === 'general'
      ? domainRaw
      : undefined;
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
  const idRaw = typeof body.id === 'string' ? body.id : '';
  const nameRaw = typeof body.name === 'string' ? body.name : '';
  // Control-char check before trim (createCustomBlock also enforces)
  if (/[\0\r\n]/.test(idRaw)) {
    return c.json({ ok: false, error: 'id contains invalid control characters' }, 400);
  }
  if (/[\0\r\n]/.test(nameRaw)) {
    return c.json({ ok: false, error: 'name contains invalid control characters' }, 400);
  }
  const id = idRaw.trim();
  const name = nameRaw.trim();
  if (!id || !name) {
    return c.json({ ok: false, error: 'id and name are required' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return c.json({ ok: false, error: 'id must be alphanumeric (- and _ allowed)' }, 400);
  }
  if (!['native', 'prompt', 'skill'].includes(body.implementationType)) {
    return c.json({ ok: false, error: 'implementationType must be native | prompt | skill' }, 400);
  }
  // Multi-line prompt OK; reject null bytes before trim
  let promptTemplate: string | undefined =
    typeof body.promptTemplate === 'string' ? body.promptTemplate : undefined;
  if (typeof promptTemplate === 'string') {
    if (/\0/.test(promptTemplate)) {
      return c.json({ ok: false, error: 'promptTemplate contains invalid control characters' }, 400);
    }
    promptTemplate = promptTemplate.trim();
  }
  if (body.implementationType === 'prompt' && !promptTemplate) {
    return c.json({ ok: false, error: 'promptTemplate is required for prompt blocks' }, 400);
  }

  // Control-char domain → general default (check before trim)
  const domainRaw0 = typeof body.domain === 'string' ? body.domain : 'general';
  const domainRaw =
    domainRaw0 && !/[\0\r\n]/.test(domainRaw0)
      ? domainRaw0.trim().toLowerCase() || 'general'
      : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as WorkflowBlock['domain'])
    : 'general';

  // Control-char category → custom default
  const categoryRaw0 = typeof body.category === 'string' ? body.category : '';
  const category =
    categoryRaw0 && !/[\0\r\n]/.test(categoryRaw0)
      ? categoryRaw0.trim() || 'custom'
      : 'custom';

  // Multi-line description OK; reject null bytes
  let description = '';
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'description contains invalid control characters' }, 400);
    }
    description = body.description.trim();
  }

  let block: WorkflowBlock;
  try {
    block = createCustomBlock({
      ...body,
      id,
      name,
      promptTemplate,
      paramDefs: body.paramDefs ?? [],
      inputDescription: body.inputDescription ?? '',
      outputDescription: body.outputDescription ?? '',
      category,
      domain,
      description,
    });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to create block');
    return c.json({ ok: false, error: msg }, 400);
  }

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
  const id = paramBlockId(c);
  if (!id) return c.json({ ok: false, error: 'Block not found' }, 404);
  const builtInMeta = listBlocks().find((b) => b.id === id);
  if (builtInMeta) return c.json({ ok: true, data: builtInMeta });

  const block = getCustomBlock(id);
  if (!block) return c.json({ ok: false, error: 'Block not found' }, 404);
  return c.json({ ok: true, data: block });
});

// PUT /api/blocks/:id
blocks.put('/:id', async (c) => {
  const id = paramBlockId(c);
  if (!id) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  const body = await c.req.json<Partial<WorkflowBlock>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const patch: Partial<WorkflowBlock> = { ...body };
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
      return c.json({ ok: false, error: 'name cannot be empty' }, 400);
    }
    const name = body.name.trim();
    if (!name) return c.json({ ok: false, error: 'name cannot be empty' }, 400);
    patch.name = name;
  }
  if (typeof body.domain === 'string') {
    const domainRaw = !/[\0\r\n]/.test(body.domain)
      ? body.domain.trim().toLowerCase() || 'general'
      : 'general';
    patch.domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
      ? (domainRaw as WorkflowBlock['domain'])
      : 'general';
  }
  if (typeof body.category === 'string') {
    patch.category =
      !/[\0\r\n]/.test(body.category) ? body.category.trim() || 'custom' : 'custom';
  }
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    patch.description = body.description.trim();
  }
  if (typeof body.promptTemplate === 'string') {
    if (/\0/.test(body.promptTemplate)) {
      return c.json({ ok: false, error: 'Invalid promptTemplate' }, 400);
    }
    patch.promptTemplate = body.promptTemplate.trim();
  }
  if (typeof body.inputDescription === 'string') {
    if (/\0/.test(body.inputDescription)) {
      return c.json({ ok: false, error: 'Invalid inputDescription' }, 400);
    }
    patch.inputDescription = body.inputDescription.trim();
  }
  if (typeof body.outputDescription === 'string') {
    if (/\0/.test(body.outputDescription)) {
      return c.json({ ok: false, error: 'Invalid outputDescription' }, 400);
    }
    patch.outputDescription = body.outputDescription.trim();
  }

  const updated = updateCustomBlock(id, patch);
  if (!updated) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true, data: updated });
});

// DELETE /api/blocks/:id
blocks.delete('/:id', (c) => {
  const id = paramBlockId(c);
  if (!id) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  const deleted = deleteCustomBlock(id);
  if (!deleted) return c.json({ ok: false, error: 'Block not found or is built-in' }, 404);
  return c.json({ ok: true });
});

export default blocks;
