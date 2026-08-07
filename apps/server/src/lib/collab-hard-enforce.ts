/**
 * Shared hard-enforce helpers for project file mutations (v0.10–v0.11).
 * Used by REST project routes and agent tool-token routes.
 */

import { getGlobalRunRegistry } from '@neos-work/agent-runtime';
import {
  getFileLockHydrated,
  isSharedEditHardEnforce,
} from './project-collab.js';

export type CollabRequestLike = {
  req: { header: (name: string) => string | undefined };
};

/**
 * Resolve collab session id (body preferred, then header).
 */
export function resolveCollabSessionId(
  c: CollabRequestLike,
  body: { sessionId?: unknown } | null | undefined,
): string {
  if (
    body
    && typeof body.sessionId === 'string'
    && !/[\0\r\n]/.test(body.sessionId)
  ) {
    const s = body.sessionId.trim();
    if (s && s.length <= 64) return s;
  }
  const hdr = c.req.header('x-neos-session-id') ?? '';
  if (typeof hdr === 'string' && !/[\0\r\n]/.test(hdr)) {
    const s = hdr.trim();
    if (s && s.length <= 64) return s;
  }
  return '';
}

/**
 * Resolve run id for agent lock-session inheritance (body `runId` or `x-neos-run-id`).
 */
export function resolveRunIdForCollabBind(
  c: CollabRequestLike,
  body: { runId?: unknown } | null | undefined,
): string {
  if (
    body
    && typeof body.runId === 'string'
    && !/[\0\r\n]/.test(body.runId)
  ) {
    const s = body.runId.trim();
    if (s && s.length <= 100) return s;
  }
  const hdr = c.req.header('x-neos-run-id') ?? '';
  if (typeof hdr === 'string' && !/[\0\r\n]/.test(hdr)) {
    const s = hdr.trim();
    if (s && s.length <= 100) return s;
  }
  return '';
}

function normalizeRunId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > 100) return '';
  return s;
}

/**
 * Session for hard-enforce: explicit collab session, else (agent only) run bind.
 * Direct session always wins over run inheritance.
 *
 * @param opts.fallbackRunId — e.g. tool-token bound runId when request omits runId (v0.11 M2)
 */
export function resolveCollabSessionIdForWrite(
  c: CollabRequestLike,
  body: { sessionId?: unknown; runId?: unknown } | null | undefined,
  source: string,
  opts?: { fallbackRunId?: string | null },
): string {
  const direct = resolveCollabSessionId(c, body);
  if (direct) return direct;
  if (source !== 'agent') return '';
  let runId = resolveRunIdForCollabBind(c, body);
  if (!runId && opts?.fallbackRunId) {
    runId = normalizeRunId(opts.fallbackRunId);
  }
  if (!runId) return '';
  const run = getGlobalRunRegistry().get(runId);
  const bound = run?.collabSessionId;
  if (typeof bound === 'string' && bound && !/[\0\r\n]/.test(bound) && bound.length <= 64) {
    return bound;
  }
  return '';
}

/**
 * When NEOS_SHARED_EDIT hard-enforce is on and a lock exists, only the holder may mutate.
 * Hydrate is owned by getFileLockHydrated (v0.10 M1).
 */
export async function hardEnforceLockBlock(
  projectId: string,
  relPath: string,
  sessionId: string,
): Promise<{
  ok: false;
  error: string;
  data: { holder: NonNullable<Awaited<ReturnType<typeof getFileLockHydrated>>> };
} | null> {
  if (!isSharedEditHardEnforce()) return null;
  const holder = await getFileLockHydrated(projectId, relPath);
  if (!holder) return null;
  if (sessionId && sessionId === holder.sessionId) return null;
  return {
    ok: false,
    error: `File locked by ${holder.displayName}`,
    data: { holder },
  };
}
