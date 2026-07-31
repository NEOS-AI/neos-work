/**
 * Domain Pack REST routes (v0.4 Task 7 + v0.5 Task 15 SDK).
 * GET    /api/domain-packs
 * GET    /api/domain-packs/:id
 * POST   /api/domain-packs/install          — { path } local dir
 * POST   /api/domain-packs/install-zip      — multipart or raw zip body
 * POST   /api/domain-packs/:id/toggle       — { enabled }
 * DELETE /api/domain-packs/:id              — uninstall custom
 */

import { Hono } from 'hono';
import {
  listPacks,
  resolvePack,
  listWorkers,
  listBlocks,
  parsePackManifest,
} from '@neos-work/workflow-engine';
import { listCustomWorkers } from '../db/workers.js';
import { safeRouteId } from '../lib/path-safety.js';
import {
  installPackFromDir,
  installPackFromZipBuffer,
  setInstalledPackEnabled,
  uninstallInstalledPack,
  DOMAIN_PACK_ZIP_MAX_BYTES,
} from '../lib/domain-pack-store.js';

const domainPacks = new Hono();

domainPacks.get('/', (c) => {
  const packs = listPacks().map((p) => {
    const custom = listCustomWorkers(p.id);
    const domainWorkers = listWorkers(p.id);
    const blocks = listBlocks(p.id);
    // Live registry count; when disabled fall back to manifest worker list
    const workerCount = Math.max(
      domainWorkers.length + custom.length,
      p.workers?.length ?? 0,
    );
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      isBuiltIn: p.isBuiltIn,
      enabled: p.enabled !== false,
      version: p.version,
      sourcePath: p.sourcePath,
      workerCount,
      blockCount: blocks.length > 0 ? blocks.length : p.blockIds.length,
      blockIds: p.blockIds,
    };
  });
  return c.json({ ok: true, data: packs });
});

/** Validate manifest without installing (devtools). */
domainPacks.post('/validate', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (body == null) return c.json({ ok: false, error: 'JSON body required' }, 400);
  // Accept { manifest } or raw manifest
  const raw =
    body && typeof body === 'object' && 'manifest' in (body as object)
      ? (body as { manifest: unknown }).manifest
      : body;
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
  return c.json({
    ok: true,
    data: {
      id: parsed.manifest.id,
      name: parsed.manifest.name,
      workerCount: parsed.manifest.workers.length,
      blockCount: parsed.manifest.blocks.length,
      version: parsed.manifest.version,
    },
  });
});

domainPacks.post('/install', async (c) => {
  const body = await c.req.json<{ path?: string }>().catch(() => null);
  const dirPath = typeof body?.path === 'string' ? body.path : '';
  if (!dirPath.trim() || /[\0\r\n]/.test(dirPath)) {
    return c.json({ ok: false, error: 'path (local pack directory) required' }, 400);
  }
  const result = await installPackFromDir(dirPath);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
  const pack = resolvePack(result.packId);
  return c.json({ ok: true, data: pack ?? { id: result.packId, enabled: result.enabled } }, 201);
});

domainPacks.post('/install-zip', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  let buf: Buffer | null = null;

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await c.req.parseBody();
      const file = form['file'] ?? form['zip'] ?? form['pack'];
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const ab = await (file as File).arrayBuffer();
        buf = Buffer.from(ab);
      }
    } catch {
      return c.json({ ok: false, error: 'failed to parse multipart body' }, 400);
    }
  } else {
    try {
      const ab = await c.req.arrayBuffer();
      if (ab.byteLength > 0) buf = Buffer.from(ab);
    } catch {
      return c.json({ ok: false, error: 'failed to read body' }, 400);
    }
  }

  if (!buf || buf.length === 0) {
    return c.json({ ok: false, error: 'zip body required' }, 400);
  }
  if (buf.length > DOMAIN_PACK_ZIP_MAX_BYTES) {
    return c.json({ ok: false, error: 'zip too large' }, 400);
  }

  const result = await installPackFromZipBuffer(buf);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
  const pack = resolvePack(result.packId);
  return c.json({ ok: true, data: pack ?? { id: result.packId, enabled: result.enabled } }, 201);
});

domainPacks.post('/:id/toggle', async (c) => {
  const id = safeRouteId(c.req.param('id'));
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'Missing or invalid "enabled" field' }, 400);
  }
  const result = await setInstalledPackEnabled(id, body.enabled);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as 400);
  }
  const pack = resolvePack(id);
  return c.json({ ok: true, data: pack ?? { id, enabled: body.enabled } });
});

domainPacks.delete('/:id', async (c) => {
  const id = safeRouteId(c.req.param('id'));
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const result = await uninstallInstalledPack(id);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, (result.status ?? 400) as 400);
  }
  return c.json({ ok: true });
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
  // Also merge live registry workers (enabled pack)
  for (const w of listWorkers(pack.id)) workerMap.set(w.id, w);

  const blocks = listBlocks(pack.id);

  return c.json({
    ok: true,
    data: {
      ...pack,
      workers: [...workerMap.values()],
      blocks,
      enabled: pack.enabled !== false,
    },
  });
});

export default domainPacks;
