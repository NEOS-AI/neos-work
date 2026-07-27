/**
 * Domain Pack REST routes (v0.4 Task 7).
 * GET /api/domain-packs
 * GET /api/domain-packs/:id
 */

import { Hono } from 'hono';
import { listPacks, resolvePack, listWorkers } from '@neos-work/workflow-engine';
import { listBlocks } from '@neos-work/workflow-engine';
import { listCustomWorkers } from '../db/workers.js';
import { safeRouteId } from '../lib/path-safety.js';

const domainPacks = new Hono();

domainPacks.get('/', (c) => {
  const packs = listPacks().map((p) => {
    const custom = listCustomWorkers(p.id);
    const builtInWorkers = listWorkers(p.id).filter((w) => w.isBuiltIn);
    // Blocks from global registry filtered by domain
    const blocks = listBlocks(p.id);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      isBuiltIn: p.isBuiltIn,
      workerCount: builtInWorkers.length + custom.length,
      blockCount: blocks.length > 0 ? blocks.length : p.blockIds.length,
      blockIds: p.blockIds,
    };
  });
  return c.json({ ok: true, data: packs });
});

domainPacks.get('/:id', (c) => {
  const id = safeRouteId(c.req.param('id'));
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const pack = resolvePack(id);
  if (!pack) return c.json({ ok: false, error: 'Not found' }, 404);

  // Include custom workers in this domain
  const custom = listCustomWorkers(pack.id);
  const workerMap = new Map(pack.workers.map((w) => [w.id, w]));
  for (const w of custom) workerMap.set(w.id, w);

  return c.json({
    ok: true,
    data: {
      ...pack,
      workers: [...workerMap.values()],
    },
  });
});

export default domainPacks;
