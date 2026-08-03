/**
 * Design Project routes (v0.5.0 M1 + v0.5.9 archive + v0.5.13 import token + v0.5.28 file SSE).
 *
 * GET    /api/projects
 * POST   /api/projects
 * POST   /api/projects/import-token
 * GET    /api/projects/:id
 * PUT    /api/projects/:id
 * DELETE /api/projects/:id
 * GET    /api/projects/:id/export.zip
 * POST   /api/projects/import.zip
 * GET    /api/projects/:id/files
 * GET    /api/projects/:id/events/stream — file.changed SSE
 * GET    /api/projects/:id/collab/stream — presence SSE (v0.6.0 M0)
 * …
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { FileRevisionSource } from '@neos-work/shared';
import * as db from '../db/projects.js';
import {
  deleteProjectPath,
  listProjectFiles,
  mkdirProjectPath,
  readProjectFile,
  writeProjectFile,
  detectEntryFile,
} from '../lib/project-files.js';
import {
  buildProjectZipBuffer,
  materializeImportedFiles,
  parseProjectZipBuffer,
  projectZipFilename,
  PROJECT_ZIP_MAX_BYTES,
} from '../lib/project-archive.js';
import { PathSandboxError } from '../lib/path-sandbox.js';
import {
  consumeImportToken,
  ImportTokenError,
  issueImportToken,
} from '../lib/import-token.js';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';
import {
  assertCollabLockConflictResponse,
  assertCollabLockSuccessResponse,
  assertCollabLocksSnapshotResponse,
  assertCollabPeersSnapshotResponse,
  assertCollabSelectionsSnapshotResponse,
  assertProjectFileWriteResponse,
} from '../lib/wire-assert.js';
import {
  publishProjectFileEvent,
  subscribeProjectFileEvents,
  type ProjectFileEvent,
} from '../lib/project-file-events.js';
import {
  acquireFileLock,
  getFileLock,
  isSharedEditHardEnforce,
  hydrateMembershipFromRegistry,
  joinProjectPresence,
  listProjectLocks,
  listProjectPeers,
  listProjectSelections,
  releaseFileLock,
  setSessionSelection,
  sweepIdlePresence,
  touchProjectPresence,
  type CollabEvent,
} from '../lib/project-collab.js';

const projects = new Hono();

function paramId(c: { req: { param: (k: string) => string } }, key = 'id'): string {
  return safeRouteId(c.req.param(key));
}

/** Extract splat path from Hono /* route (may be "path" or include slashes). */
function splatPath(c: { req: { path: string; param: (k: string) => string } }, prefix: string): string {
  // Prefer named splat if present
  const direct = c.req.param('*') || c.req.param('path') || '';
  if (direct) return direct.replace(/^\/+/, '');
  // Fallback: strip route prefix from full path
  const idx = c.req.path.indexOf(prefix);
  if (idx >= 0) {
    return c.req.path.slice(idx + prefix.length).replace(/^\/+/, '');
  }
  return '';
}

function sandboxStatus(err: PathSandboxError): 400 | 403 | 404 {
  if (err.code === 'not_found') return 404;
  if (err.code === 'outside_root' || err.code === 'symlink_escape' || err.code === 'denied') {
    return 403;
  }
  return 400;
}

// ── Project CRUD ───────────────────────────────────────────

projects.get('/', (c) => {
  return c.json({ ok: true, data: db.listProjects() });
});

/**
 * Issue a single-use desktop import token bound to a folder path.
 * Used after Tauri folder picker before create/update with baseDir.
 */
projects.post('/import-token', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const rawPath = typeof body.path === 'string' ? body.path : '';
  try {
    const issued = issueImportToken(rawPath);
    return c.json({ ok: true, data: issued }, 201);
  } catch (err) {
    if (err instanceof ImportTokenError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid import path') }, 400);
    }
    if (err instanceof PathSandboxError) {
      return c.json(
        { ok: false, error: publicErrorMessage(err, 'Invalid import path') },
        sandboxStatus(err),
      );
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to issue import token') }, 400);
  }
});

projects.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  try {
    const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
    if (baseDir) {
      // When importToken is provided, enforce single-use path binding (desktop gate).
      // Absent token remains allowed for API/tests (compat); desktop always sends token.
      consumeImportToken(body.importToken, baseDir);
    }
    const project = db.createProject({
      name: typeof body.name === 'string' ? body.name : '',
      baseDir,
      entryFile:
        body.entryFile === null
          ? null
          : typeof body.entryFile === 'string'
            ? body.entryFile
            : undefined,
      designSystemId:
        body.designSystemId === null
          ? null
          : typeof body.designSystemId === 'string'
            ? body.designSystemId
            : undefined,
      meta:
        body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
          ? (body.meta as Record<string, unknown>)
          : undefined,
    });
    return c.json({ ok: true, data: project }, 201);
  } catch (err) {
    if (err instanceof ImportTokenError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid importToken') }, 403);
    }
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid baseDir') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to create project') }, 400);
  }
});

/** Import a neos-project ZIP (multipart field "file" or raw body). */
projects.post('/import.zip', async (c) => {
  try {
    let buf: Buffer | null = null;
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const ab = await (file as File).arrayBuffer();
        buf = Buffer.from(ab);
      }
    } else {
      const ab = await c.req.arrayBuffer();
      if (ab.byteLength > 0) buf = Buffer.from(ab);
    }
    if (!buf || buf.length === 0) {
      return c.json({ ok: false, error: 'ZIP body required (multipart file or raw)' }, 400);
    }
    if (buf.length > PROJECT_ZIP_MAX_BYTES) {
      return c.json({
        ok: false,
        error: `Archive exceeds max size (${PROJECT_ZIP_MAX_BYTES} bytes)`,
      }, 400);
    }

    const parsed = await parseProjectZipBuffer(buf);
    if (!parsed.ok) {
      return c.json({ ok: false, error: parsed.error }, 400);
    }

    const project = db.createProject({
      name: parsed.name,
      entryFile: parsed.entryFile,
      designSystemId: parsed.designSystemId,
      meta: { ...parsed.meta, importedFrom: 'neos-project-zip' },
    });

    try {
      materializeImportedFiles(project.baseDir, parsed.files);
    } catch (err) {
      if (err instanceof PathSandboxError) {
        return c.json(
          { ok: false, error: publicErrorMessage(err, 'Import path rejected') },
          sandboxStatus(err),
        );
      }
      throw err;
    }

    // Prefer manifest entry when present in the archive; else re-detect on disk
    const detected = detectEntryFile(project.baseDir);
    const entryFile =
      (parsed.entryFile && parsed.files.some((f) => f.path === parsed.entryFile)
        ? parsed.entryFile
        : null) ?? detected ?? project.entryFile;
    if (entryFile !== project.entryFile) {
      db.updateProject(project.id, { entryFile });
    }

    const refreshed = db.getProject(project.id) ?? project;
    return c.json(
      {
        ok: true,
        data: {
          project: refreshed,
          filesImported: parsed.files.length,
        },
      },
      201,
    );
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Import failed') }, 400);
  }
});

projects.get('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: project });
});

projects.get('/:id/export.zip', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  try {
    const buf = await buildProjectZipBuffer(project);
    const filename = projectZipFilename(project.name);
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    // Hono body typings expect ArrayBufferView — copy into a Uint8Array
    return c.body(Uint8Array.from(buf));
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json(
        { ok: false, error: publicErrorMessage(err, 'Export failed') },
        sandboxStatus(err),
      );
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Export failed') }, 400);
  }
});

projects.put('/:id', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  try {
    const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
    if (baseDir) {
      consumeImportToken(body.importToken, baseDir);
    }
    const updated = db.updateProject(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      baseDir,
      entryFile:
        body.entryFile === null
          ? null
          : typeof body.entryFile === 'string'
            ? body.entryFile
            : undefined,
      designSystemId:
        body.designSystemId === null
          ? null
          : typeof body.designSystemId === 'string'
            ? body.designSystemId
            : undefined,
      meta:
        body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
          ? (body.meta as Record<string, unknown>)
          : undefined,
    });
    if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
    return c.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof ImportTokenError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid importToken') }, 403);
    }
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Invalid baseDir') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to update project') }, 400);
  }
});

projects.delete('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const ok = db.deleteProject(id);
  if (!ok) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Project collab presence (SSE) — v0.6.0 M0 ──────────────

/**
 * Presence channel: connection = join; disconnect = leave.
 * Query: name=displayName (optional, sanitized).
 * M1: touch() each loop tick; idle sweep; sessionId in ready for heartbeats.
 */
projects.get('/:id/collab/stream', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);

  const nameRaw = c.req.query('name') ?? '';
  const displayName = typeof nameRaw === 'string' && !/[\0\r\n]/.test(nameRaw) ? nameRaw : '';

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return stream(c, async (s) => {
    const queue: CollabEvent[] = [];
    const MAX_QUEUE = 64;
    let closed = false;

    // v0.8 M1: pull Redis registry peers before join so presence.sync is complete
    try {
      await hydrateMembershipFromRegistry(id);
    } catch {
      /* registry optional */
    }

    const joined = joinProjectPresence({
      projectId: id,
      displayName,
      listener: (ev) => {
        if (closed) return;
        if (queue.length >= MAX_QUEUE) queue.shift();
        queue.push(ev);
      },
    });
    if (!joined) {
      await s.write(`event: error\ndata: ${JSON.stringify({ error: 'join failed' })}\n\n`);
      return;
    }

    try {
      await s.write(
        `event: ready\ndata: ${JSON.stringify({ projectId: id, sessionId: joined.sessionId })}\n\n`,
      );
      await s.write(`event: ${joined.sync.type}\ndata: ${JSON.stringify(joined.sync)}\n\n`);
      const started = Date.now();
      const maxMs = 30 * 60 * 1000;
      let tick = 0;
      while (Date.now() - started < maxMs) {
        if (c.req.raw.signal.aborted) break;
        joined.touch();
        while (queue.length > 0) {
          const ev = queue.shift()!;
          await s.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        }
        // Periodic idle sweep (every ~15s)
        tick += 1;
        if (tick % 15 === 0) sweepIdlePresence(id);
        await s.write(`: ping\n\n`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    } finally {
      closed = true;
      joined.unsub();
    }
  });
});

/** Snapshot of current peers (REST helper for UI refresh). */
projects.get('/:id/collab/peers', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  try {
    await hydrateMembershipFromRegistry(id);
  } catch {
    /* optional */
  }
  sweepIdlePresence(id);
  const peersBody = { ok: true as const, data: { peers: listProjectPeers(id) } };
  assertCollabPeersSnapshotResponse(peersBody);
  return c.json(peersBody);
});

/** Heartbeat — keeps idle sweep from dropping a session if SSE stalls. */
projects.post('/:id/collab/heartbeat', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json().catch(() => null);
  const sessionId =
    body && typeof body === 'object' && typeof (body as { sessionId?: unknown }).sessionId === 'string'
      ? (body as { sessionId: string }).sessionId
      : '';
  if (!sessionId || /[\0\r\n]/.test(sessionId)) {
    return c.json({ ok: false, error: 'sessionId required' }, 400);
  }
  const ok = touchProjectPresence(id, sessionId);
  if (!ok) return c.json({ ok: false, error: 'Unknown session' }, 404);
  return c.json({ ok: true, data: { touched: true } });
});

/** List advisory file locks (M3). */
projects.get('/:id/collab/locks', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const locksBody = {
    ok: true as const,
    data: {
      locks: listProjectLocks(id),
      hardEnforce: isSharedEditHardEnforce(),
    },
  };
  assertCollabLocksSnapshotResponse(locksBody);
  return c.json(locksBody);
});

/**
 * Snapshot of peer selections (v0.7 M2).
 */
projects.get('/:id/collab/selections', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const selBody = { ok: true as const, data: { selections: listProjectSelections(id) } };
  assertCollabSelectionsSnapshotResponse(selBody);
  return c.json(selBody);
});

/**
 * Publish or clear this session's editing selection (path + selector [+ multi]).
 * body: {
 *   sessionId,
 *   path?: string | null,
 *   selector?: string | null,
 *   layerId?: string | null,
 *   selectors?: string[],  // v0.8 M3 multi-select (last = primary)
 *   layerIds?: string[]
 * }
 */
projects.post('/:id/collab/selection', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const sessionId =
    typeof (body as { sessionId?: unknown }).sessionId === 'string'
      ? (body as { sessionId: string }).sessionId
      : '';
  if (!sessionId || /[\0\r\n]/.test(sessionId)) {
    return c.json({ ok: false, error: 'sessionId required' }, 400);
  }
  const pathRaw = (body as { path?: unknown }).path;
  const selectorRaw = (body as { selector?: unknown }).selector;
  const layerIdRaw = (body as { layerId?: unknown }).layerId;
  const selectorsRaw = (body as { selectors?: unknown }).selectors;
  const layerIdsRaw = (body as { layerIds?: unknown }).layerIds;
  const path =
    pathRaw === null || pathRaw === undefined
      ? null
      : typeof pathRaw === 'string'
        ? pathRaw
        : null;
  const selector =
    selectorRaw === null || selectorRaw === undefined
      ? null
      : typeof selectorRaw === 'string'
        ? selectorRaw
        : null;
  const layerId =
    layerIdRaw === null || layerIdRaw === undefined
      ? null
      : typeof layerIdRaw === 'string'
        ? layerIdRaw
        : null;
  if (pathRaw !== null && pathRaw !== undefined && typeof pathRaw !== 'string') {
    return c.json({ ok: false, error: 'path must be string or null' }, 400);
  }
  if (selectorRaw !== null && selectorRaw !== undefined && typeof selectorRaw !== 'string') {
    return c.json({ ok: false, error: 'selector must be string or null' }, 400);
  }
  if (
    selectorsRaw !== null
    && selectorsRaw !== undefined
    && !Array.isArray(selectorsRaw)
  ) {
    return c.json({ ok: false, error: 'selectors must be an array' }, 400);
  }
  const r = setSessionSelection({
    projectId: id,
    sessionId,
    path,
    selector,
    layerId,
    selectors: Array.isArray(selectorsRaw) ? (selectorsRaw as string[]) : null,
    layerIds: Array.isArray(layerIdsRaw) ? (layerIdsRaw as string[]) : null,
  });
  if (!r.ok) {
    const status = r.error.includes('Session') ? 404 : 400;
    return c.json({ ok: false, error: r.error }, status);
  }
  return c.json({ ok: true, data: { selection: r.selection } });
});

/**
 * Acquire or release a file lock.
 * body: { sessionId, path, action: 'acquire' | 'release' }
 */
projects.post('/:id/collab/locks', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const sessionId =
    typeof (body as { sessionId?: unknown }).sessionId === 'string'
      ? (body as { sessionId: string }).sessionId
      : '';
  const path =
    typeof (body as { path?: unknown }).path === 'string'
      ? (body as { path: string }).path
      : '';
  const actionRaw =
    typeof (body as { action?: unknown }).action === 'string'
      ? (body as { action: string }).action.trim().toLowerCase()
      : '';
  if (!sessionId || /[\0\r\n]/.test(sessionId)) {
    return c.json({ ok: false, error: 'sessionId required' }, 400);
  }
  if (!path) return c.json({ ok: false, error: 'path required' }, 400);
  if (actionRaw !== 'acquire' && actionRaw !== 'release') {
    return c.json({ ok: false, error: "action must be 'acquire' or 'release'" }, 400);
  }
  if (actionRaw === 'release') {
    const r = releaseFileLock({ projectId: id, sessionId, path });
    if (!r.ok) {
      const conflictBody = { ok: false as const, error: r.error };
      assertCollabLockConflictResponse(conflictBody);
      return c.json(conflictBody, 409);
    }
    const releaseBody = { ok: true as const, data: { released: true, path } };
    assertCollabLockSuccessResponse(releaseBody);
    return c.json(releaseBody);
  }
  const r = acquireFileLock({ projectId: id, sessionId, path });
  if (!r.ok) {
    const conflictBody = {
      ok: false as const,
      error: r.error,
      data: r.holder ? { holder: r.holder } : undefined,
    };
    if (r.holder) assertCollabLockConflictResponse(conflictBody);
    return c.json(conflictBody, r.holder ? 409 : 400);
  }
  const lockBody = { ok: true as const, data: { lock: r.lock } };
  assertCollabLockSuccessResponse(lockBody);
  return c.json(lockBody);
});

// ── Project file events (SSE) ──────────────────────────────

/**
 * Long-lived SSE of project file mutations (write / delete / agent create).
 * Clients reload open buffers on `file.changed` / `file.created` for the open path.
 */
projects.get('/:id/events/stream', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return stream(c, async (s) => {
    const queue: ProjectFileEvent[] = [];
    const MAX_QUEUE = 256;
    let closed = false;
    const unsub = subscribeProjectFileEvents(id, (ev) => {
      if (closed) return;
      if (queue.length >= MAX_QUEUE) queue.shift(); // drop oldest under burst
      queue.push(ev);
    });

    try {
      await s.write(`event: ready\ndata: ${JSON.stringify({ projectId: id })}\n\n`);
      const started = Date.now();
      const maxMs = 30 * 60 * 1000;
      while (Date.now() - started < maxMs) {
        if (c.req.raw.signal.aborted) break;
        while (queue.length > 0) {
          const ev = queue.shift()!;
          await s.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        }
        // heartbeat keeps proxies alive
        await s.write(`: ping\n\n`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    } finally {
      closed = true;
      unsub();
    }
  });
});

// ── Files ──────────────────────────────────────────────────

projects.get('/:id/files', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  try {
    const files = listProjectFiles(project.baseDir, { entryFile: project.entryFile });
    return c.json({ ok: true, data: files });
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'List failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'List failed') }, 500);
  }
});

projects.get('/:id/files/*', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  const rel = splatPath(c, `/api/projects/${id}/files/`);
  if (!rel) return c.json({ ok: false, error: 'path required' }, 400);
  try {
    const file = readProjectFile(project.baseDir, rel);
    return c.json({ ok: true, data: file });
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Read failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Read failed') }, 500);
  }
});

projects.put('/:id/files/*', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  const rel = splatPath(c, `/api/projects/${id}/files/`);
  if (!rel) return c.json({ ok: false, error: 'path required' }, 400);

  const body = await c.req
    .json<{ content?: string; source?: string; sessionId?: string }>()
    .catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  const sourceRaw = typeof body.source === 'string' ? body.source : 'user';
  const source: FileRevisionSource = (
    ['user', 'agent', 'import', 'restore'] as FileRevisionSource[]
  ).includes(sourceRaw as FileRevisionSource)
    ? (sourceRaw as FileRevisionSource)
    : 'user';

  // M3 hard enforce: when NEOS_SHARED_EDIT=1, reject writes if another session holds the lock
  if (isSharedEditHardEnforce() && source === 'user') {
    const holder = getFileLock(id, rel);
    if (holder) {
      const hdr = c.req.header('x-neos-session-id') ?? '';
      const sessionId =
        typeof body.sessionId === 'string' && !/[\0\r\n]/.test(body.sessionId)
          ? body.sessionId.trim()
          : typeof hdr === 'string' && !/[\0\r\n]/.test(hdr)
            ? hdr.trim()
            : '';
      if (!sessionId || sessionId !== holder.sessionId) {
        return c.json(
          {
            ok: false,
            error: `File locked by ${holder.displayName}`,
            data: { holder },
          },
          423,
        );
      }
    }
  }

  try {
    const written = writeProjectFile(project.baseDir, rel, body.content);
    // Revision stores the saved tip (source of truth on disk) for restore.
    db.recordFileRevision({
      projectId: project.id,
      path: written.path,
      content: body.content,
      source,
    });
    // touch project updated_at
    db.updateProject(project.id, {});
    publishProjectFileEvent({
      type: written.created ? 'file.created' : 'file.changed',
      projectId: project.id,
      path: written.path,
      source,
      hash: written.hash,
    });
    const writeBody = {
      ok: true as const,
      data: {
        path: written.path,
        hash: written.hash,
        bytes: written.bytes,
        created: written.created,
      },
    };
    assertProjectFileWriteResponse(writeBody);
    return c.json(writeBody);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Write failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Write failed') }, 400);
  }
});

projects.delete('/:id/files/*', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  const rel = splatPath(c, `/api/projects/${id}/files/`);
  if (!rel) return c.json({ ok: false, error: 'path required' }, 400);
  try {
    const result = deleteProjectPath(project.baseDir, rel);
    publishProjectFileEvent({
      type: 'file.deleted',
      projectId: project.id,
      path: result.path || rel,
      source: 'user',
    });
    return c.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Delete failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Delete failed') }, 400);
  }
});

projects.post('/:id/mkdir', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ path?: string }>().catch(() => null);
  if (!body || typeof body.path !== 'string') {
    return c.json({ ok: false, error: 'path string required' }, 400);
  }
  try {
    const rel = mkdirProjectPath(project.baseDir, body.path);
    return c.json({ ok: true, data: { path: rel } }, 201);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'mkdir failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'mkdir failed') }, 400);
  }
});

// ── Revisions ──────────────────────────────────────────────

projects.get('/:id/revisions', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const filePath = c.req.query('path') ?? undefined;
  return c.json({ ok: true, data: db.listFileRevisions(id, filePath) });
});

projects.get('/:id/revisions/:revisionId', (c) => {
  const id = paramId(c);
  const revisionId = safeRouteId(c.req.param('revisionId'));
  if (!id || !revisionId) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getFileRevision(revisionId);
  if (!rev || rev.projectId !== id) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: rev });
});

projects.post('/:id/revisions/:revisionId/restore', (c) => {
  const id = paramId(c);
  const revisionId = safeRouteId(c.req.param('revisionId'));
  if (!id || !revisionId) return c.json({ ok: false, error: 'Not found' }, 404);
  const project = db.getProject(id);
  if (!project) return c.json({ ok: false, error: 'Not found' }, 404);
  const rev = db.getFileRevision(revisionId);
  if (!rev || rev.projectId !== id || rev.content == null) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  try {
    const written = writeProjectFile(project.baseDir, rev.path, rev.content);
    db.recordFileRevision({
      projectId: project.id,
      path: written.path,
      content: rev.content,
      source: 'restore',
    });
    publishProjectFileEvent({
      type: 'file.changed',
      projectId: project.id,
      path: written.path,
      source: 'restore',
      hash: written.hash,
    });
    return c.json({ ok: true, data: { path: written.path, hash: written.hash } });
  } catch (err) {
    if (err instanceof PathSandboxError) {
      return c.json({ ok: false, error: publicErrorMessage(err, 'Restore failed') }, sandboxStatus(err));
    }
    return c.json({ ok: false, error: publicErrorMessage(err, 'Restore failed') }, 400);
  }
});

// ── Preview comments ───────────────────────────────────────

projects.get('/:id/preview-comments', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const filePath = c.req.query('path') ?? undefined;
  return c.json({ ok: true, data: db.listPreviewComments(id, filePath) });
});

projects.post('/:id/preview-comments', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req
    .json<{ filePath?: string; selector?: string; body?: string }>()
    .catch(() => null);
  if (!body) return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  try {
    const comment = db.createPreviewComment({
      projectId: id,
      filePath: typeof body.filePath === 'string' ? body.filePath : '',
      selector: typeof body.selector === 'string' ? body.selector : '',
      body: typeof body.body === 'string' ? body.body : '',
    });
    return c.json({ ok: true, data: comment }, 201);
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to create comment') }, 400);
  }
});

projects.delete('/:id/preview-comments/:commentId', (c) => {
  const id = paramId(c);
  const commentId = safeRouteId(c.req.param('commentId'));
  if (!id || !commentId) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const ok = db.deletePreviewComment(commentId);
  if (!ok) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Conversations ──────────────────────────────────────────

projects.get('/:id/conversations', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: db.listConversations(id) });
});

projects.post('/:id/conversations', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ title?: string }>().catch(() => ({} as { title?: string }));
  try {
    const conv = db.createConversation(id, body?.title);
    return c.json({ ok: true, data: conv }, 201);
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to create conversation') }, 400);
  }
});

projects.get('/:id/conversations/:conversationId/messages', (c) => {
  const id = paramId(c);
  const conversationId = safeRouteId(c.req.param('conversationId'));
  if (!id || !conversationId) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: db.listMessages(conversationId) });
});

projects.post('/:id/conversations/:conversationId/messages', async (c) => {
  const id = paramId(c);
  const conversationId = safeRouteId(c.req.param('conversationId'));
  if (!id || !conversationId) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!db.getProject(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req
    .json<{ role?: string; content?: string; agentId?: string }>()
    .catch(() => null);
  if (!body) return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  try {
    const role = body.role === 'assistant' || body.role === 'system' ? body.role : 'user';
    const msg = db.addMessage({
      conversationId,
      role,
      content: typeof body.content === 'string' ? body.content : '',
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
    });
    return c.json({ ok: true, data: msg }, 201);
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'Failed to add message') }, 400);
  }
});

export default projects;
export { projects };
