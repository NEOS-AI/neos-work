/**
 * Agent tool tokens (PLAN_FOR_V0_5_0 Task 9 / §22).
 *
 * Short-lived tokens bound to a projectId (+ optional runId) and capabilities.
 * Tool routes derive project scope from the token only — body overrides → 403.
 */

import { randomBytes } from 'node:crypto';

/** Agent tool-token capabilities (v0.5 Task 9 + v0.11 M2 files). */
export type ToolCapability = 'live-artifacts' | 'media' | 'files';

export class ToolTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired' | 'capability' | 'override',
  ) {
    super(message);
    this.name = 'ToolTokenError';
  }
}

export interface ToolTokenRecord {
  token: string;
  projectId: string;
  runId: string | null;
  capabilities: ToolCapability[];
  expiresAt: number;
  createdAt: number;
}

const store = new Map<string, ToolTokenRecord>();
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_TOKENS = 500;

export function clearToolTokens(): void {
  store.clear();
}

function purge(now = Date.now()): void {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

function safeId(raw: unknown, max = 100): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > max) return '';
  return s;
}

const CAPS = new Set<string>(['live-artifacts', 'media', 'files']);

function normalizeCaps(raw: unknown): ToolCapability[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCapability[] = [];
  for (const c of raw) {
    if (typeof c !== 'string' || /[\0\r\n]/.test(c)) continue;
    const t = c.trim().toLowerCase();
    if (CAPS.has(t) && !out.includes(t as ToolCapability)) {
      out.push(t as ToolCapability);
    }
  }
  return out;
}

export function issueToolToken(input: {
  projectId: string;
  runId?: string | null;
  capabilities: ToolCapability[] | string[];
  ttlMs?: number;
}): { token: string; projectId: string; runId: string | null; capabilities: ToolCapability[]; expiresAt: string; expiresInMs: number } {
  const projectId = safeId(input.projectId);
  if (!projectId) throw new ToolTokenError('Invalid projectId', 'invalid');
  const runIdRaw = input.runId == null || input.runId === '' ? null : safeId(input.runId);
  if (input.runId != null && input.runId !== '' && !runIdRaw) {
    throw new ToolTokenError('Invalid runId', 'invalid');
  }
  const capabilities = normalizeCaps(input.capabilities);
  if (capabilities.length === 0) {
    throw new ToolTokenError('At least one capability is required', 'invalid');
  }
  const ttl = Math.max(10_000, Math.min(input.ttlMs ?? DEFAULT_TTL_MS, 24 * 60 * 60 * 1000));
  purge();
  if (store.size >= MAX_TOKENS) {
    // drop oldest
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  const token = `ntt_${randomBytes(24).toString('base64url')}`;
  const now = Date.now();
  const rec: ToolTokenRecord = {
    token,
    projectId,
    runId: runIdRaw,
    capabilities,
    expiresAt: now + ttl,
    createdAt: now,
  };
  store.set(token, rec);
  return {
    token,
    projectId,
    runId: runIdRaw,
    capabilities,
    expiresAt: new Date(rec.expiresAt).toISOString(),
    expiresInMs: ttl,
  };
}

export function resolveToolToken(raw: unknown): ToolTokenRecord {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) {
    throw new ToolTokenError('Invalid tool token', 'invalid');
  }
  const token = raw.trim();
  if (!token || token.length > 200) {
    throw new ToolTokenError('Invalid tool token', 'invalid');
  }
  purge();
  const rec = store.get(token);
  if (!rec) throw new ToolTokenError('Unknown or expired tool token', 'expired');
  if (rec.expiresAt <= Date.now()) {
    store.delete(token);
    throw new ToolTokenError('Tool token expired', 'expired');
  }
  return rec;
}

export function requireToolCapability(rec: ToolTokenRecord, cap: ToolCapability): void {
  if (!rec.capabilities.includes(cap)) {
    throw new ToolTokenError(`Missing capability: ${cap}`, 'capability');
  }
}

/**
 * Reject body fields that attempt to override token-bound projectId / runId.
 * Missing body fields are fine; only explicit mismatch is 403.
 */
export function assertNoScopeOverride(
  rec: ToolTokenRecord,
  body: { projectId?: unknown; runId?: unknown },
): void {
  if (body.projectId != null && body.projectId !== '') {
    const pid = safeId(body.projectId);
    if (!pid || pid !== rec.projectId) {
      throw new ToolTokenError('projectId override denied', 'override');
    }
  }
  if (body.runId != null && body.runId !== '') {
    const rid = safeId(body.runId);
    if (rec.runId == null) {
      // token not bound to run — ignore extra runId or reject? OD: cannot override
      // Allow only if matches when token has runId; when token has no runId, reject body runId as override attempt
      throw new ToolTokenError('runId override denied', 'override');
    }
    if (!rid || rid !== rec.runId) {
      throw new ToolTokenError('runId override denied', 'override');
    }
  }
}

export function extractBearerToken(authHeader: string | undefined): string {
  if (typeof authHeader !== 'string' || /[\0\r\n]/.test(authHeader)) return '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return '';
  const t = m[1].trim();
  if (!t || /[\0\r\n]/.test(t)) return '';
  return t;
}

export function toolTokenCount(): number {
  purge();
  return store.size;
}
