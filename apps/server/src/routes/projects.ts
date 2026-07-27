/**
 * Design Project routes (v0.5.0 M1 + v0.5.9 archive).
 *
 * GET    /api/projects
 * POST   /api/projects
 * GET    /api/projects/:id
 * PUT    /api/projects/:id
 * DELETE /api/projects/:id
 * GET    /api/projects/:id/export.zip
 * POST   /api/projects/import.zip
 * GET    /api/projects/:id/files
 * …
 */

import { Hono } from 'hono';
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
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';

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

projects.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  try {
    const project = db.createProject({
      name: typeof body.name === 'string' ? body.name : '',
      baseDir: typeof body.baseDir === 'string' ? body.baseDir : undefined,
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
    const updated = db.updateProject(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      baseDir: typeof body.baseDir === 'string' ? body.baseDir : undefined,
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

  const body = await c.req.json<{ content?: string; source?: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  const sourceRaw = typeof body.source === 'string' ? body.source : 'user';
  const source: FileRevisionSource = (
    ['user', 'agent', 'import', 'restore'] as FileRevisionSource[]
  ).includes(sourceRaw as FileRevisionSource)
    ? (sourceRaw as FileRevisionSource)
    : 'user';

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
    return c.json({
      ok: true,
      data: {
        path: written.path,
        hash: written.hash,
        bytes: written.bytes,
        created: written.created,
      },
    });
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
