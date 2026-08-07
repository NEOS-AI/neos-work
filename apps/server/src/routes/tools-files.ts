/**
 * Agent tool-token routes for Design Project files (v0.11 M2 / Q36).
 *
 * Auth: Bearer <tool-token> (not the daemon AUTH_TOKEN).
 * projectId is derived from the token; body projectId/runId override → 403.
 * Writes always use source=agent and the same hard-enforce rules as REST agent PUTs.
 *
 * POST /api/tools/files/write
 */

import { Hono } from 'hono';
import { normalizeProjectRelPath, type FileRevisionSource } from '@neos-work/shared';
import * as db from '../db/projects.js';
import {
  hardEnforceLockBlock,
  resolveCollabSessionIdForWrite,
} from '../lib/collab-hard-enforce.js';
import { publicErrorMessage } from '../lib/errors.js';
import { PathSandboxError } from '../lib/path-sandbox.js';
import { publishProjectFileEvent } from '../lib/project-file-events.js';
import { writeProjectFile } from '../lib/project-files.js';
import { shouldHardEnforceWriteSource } from '../lib/project-collab.js';
import {
  assertNoScopeOverride,
  extractBearerToken,
  requireToolCapability,
  resolveToolToken,
  ToolTokenError,
  type ToolTokenRecord,
} from '../lib/tool-tokens.js';
import { assertProjectFileWriteResponse } from '../lib/wire-assert.js';

const tools = new Hono();

function authTool(c: { req: { header: (k: string) => string | undefined } }): ToolTokenRecord {
  const token = extractBearerToken(c.req.header('Authorization'));
  const rec = resolveToolToken(token);
  requireToolCapability(rec, 'files');
  return rec;
}

function toolError(
  err: unknown,
): { status: 401 | 403 | 400 | 404 | 500; body: { ok: false; error: string } } {
  if (err instanceof ToolTokenError) {
    const status =
      err.code === 'override' || err.code === 'capability' ? 403
        : err.code === 'expired' || err.code === 'invalid' ? 401
          : 400;
    return { status, body: { ok: false, error: publicErrorMessage(err, 'Tool auth failed') } };
  }
  const msg = publicErrorMessage(err, 'Request failed');
  const status = /not found/i.test(msg) ? 404 : 400;
  return { status, body: { ok: false, error: msg } };
}

function sandboxStatus(err: PathSandboxError): 400 | 403 | 404 {
  if (err.code === 'not_found') return 404;
  if (err.code === 'outside_root' || err.code === 'symlink_escape' || err.code === 'denied') {
    return 403;
  }
  return 400;
}

/**
 * POST /api/tools/files/write
 * Body: { path, content, sessionId?, runId? }
 * Headers: Authorization: Bearer <tool-token>, optional x-neos-session-id / x-neos-run-id
 */
tools.post('/write', async (c) => {
  try {
    const rec = authTool(c);
    const raw = await c.req.json().catch(() => null);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    if (!body) {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    assertNoScopeOverride(rec, body);

    const project = db.getProject(rec.projectId);
    if (!project) {
      return c.json({ ok: false, error: 'Project not found' }, 404);
    }

    const pathRaw = typeof body.path === 'string' ? body.path : '';
    const rel = normalizeProjectRelPath(pathRaw);
    if (!rel) {
      return c.json({ ok: false, error: 'path required (project-relative)' }, 400);
    }
    if (typeof body.content !== 'string') {
      return c.json({ ok: false, error: 'content string required' }, 400);
    }

    // Tool writes are always agent-origin (Q36)
    const source: FileRevisionSource = 'agent';
    if (shouldHardEnforceWriteSource(source)) {
      const sessionId = resolveCollabSessionIdForWrite(c, body, source, {
        fallbackRunId: rec.runId,
      });
      const blocked = await hardEnforceLockBlock(rec.projectId, rel, sessionId);
      if (blocked) return c.json(blocked, 423);
    }

    const written = writeProjectFile(project.baseDir, rel, body.content);
    db.recordFileRevision({
      projectId: project.id,
      path: written.path,
      content: body.content,
      source,
    });
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
      return c.json(
        { ok: false, error: publicErrorMessage(err, 'Write failed') },
        sandboxStatus(err),
      );
    }
    const e = toolError(err);
    return c.json(e.body, e.status);
  }
});

export default tools;
