/**
 * Collab / lock UX helpers (v0.11 M1).
 * Shared by desktop + web for consistent 423 / status copy.
 */

/** Lock holder from 409/423 envelopes (`data.holder`). */
export interface LockHolderInfo {
  sessionId: string;
  displayName: string;
  path?: string;
  acquiredAt?: string;
}

/** Ops snapshot from GET /api/collab/status (no secrets). */
export interface CollabStatusData {
  bus?: string;
  nodeId?: string;
  ready?: boolean;
  detail?: string | null;
  presence?: { kind?: string; ready?: boolean; detail?: string | null };
  locks?: { kind?: string; ready?: boolean; detail?: string | null };
  sharedEdit?: {
    hardEnforce?: boolean;
    agentsHardEnforce?: boolean;
  };
}

function scrubLabel(raw: unknown, max = 48): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().replace(/[<>]/g, '').slice(0, max);
}

/**
 * Extract lock holder from API envelope `data` (or a body that embeds `holder`).
 */
export function extractLockHolder(data: unknown): LockHolderInfo | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const root = data as Record<string, unknown>;
  const holderRaw =
    root.holder
    && typeof root.holder === 'object'
    && !Array.isArray(root.holder)
      ? (root.holder as Record<string, unknown>)
      : root.sessionId != null
        ? root
        : null;
  if (!holderRaw) return null;
  if (typeof holderRaw.sessionId !== 'string' || /[\0\r\n]/.test(holderRaw.sessionId)) {
    return null;
  }
  const sessionId = holderRaw.sessionId.trim();
  if (!sessionId || sessionId.length > 64) return null;
  const displayName = scrubLabel(holderRaw.displayName) || 'Anonymous';
  const path =
    typeof holderRaw.path === 'string' && !/[\0\r\n]/.test(holderRaw.path)
      ? holderRaw.path.trim().slice(0, 512) || undefined
      : undefined;
  const acquiredAt =
    typeof holderRaw.acquiredAt === 'string' && !/[\0\r\n]/.test(holderRaw.acquiredAt)
      ? holderRaw.acquiredAt.trim().slice(0, 64) || undefined
      : undefined;
  return { sessionId, displayName, path, acquiredAt };
}

/** Short session id for UI (first 8 chars). */
export function shortSessionId(sessionId: string): string {
  const s = scrubLabel(sessionId, 64);
  if (!s) return '';
  return s.length > 8 ? s.slice(0, 8) : s;
}

/**
 * User-visible message for hard-enforce 423 / advisory lock conflicts.
 * Example: `Locked by Alice (a1b2c3d4)`.
 */
export function formatLockHolderMessage(
  holder: LockHolderInfo | null | undefined,
  opts?: { fallback?: string },
): string {
  if (!holder?.sessionId) {
    return opts?.fallback ?? 'File is locked by another session';
  }
  const name = scrubLabel(holder.displayName) || 'Anonymous';
  const short = shortSessionId(holder.sessionId);
  return short ? `Locked by ${name} (${short})` : `Locked by ${name}`;
}

/** True when an error string looks like a file-lock hard-enforce failure. */
export function isFileLockErrorMessage(msg: string | null | undefined): boolean {
  if (typeof msg !== 'string' || !msg.trim()) return false;
  return /file\s+locked\s+by|locked\s+by\s+\S|HTTP\s*423|\b423\b/i.test(msg);
}

/**
 * Normalize run / agent failure text when it is lock-related.
 * Returns null when the error is not a lock failure.
 */
export function formatRunLockFailureMessage(
  error: string | null | undefined,
): string | null {
  if (typeof error !== 'string' || !error.trim()) return null;
  if (!isFileLockErrorMessage(error)) return null;
  const cleaned = error.replace(/[\0\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  // Server already emits "File locked by {displayName}"
  if (/^file\s+locked\s+by\s+/i.test(cleaned)) {
    return cleaned;
  }
  if (/^locked\s+by\s+/i.test(cleaned)) {
    return cleaned;
  }
  return `Agent write blocked by file lock: ${cleaned}`;
}

/**
 * One-line shared-edit flags for ops panels.
 * Example: `hard-enforce on · agents on`
 */
export function formatSharedEditFlags(sharedEdit: CollabStatusData['sharedEdit']): string {
  if (!sharedEdit || typeof sharedEdit !== 'object') return 'hard-enforce off';
  const hard = sharedEdit.hardEnforce === true;
  const agents = sharedEdit.agentsHardEnforce === true;
  if (!hard) return 'hard-enforce off';
  return agents ? 'hard-enforce on · agents on' : 'hard-enforce on · agents off';
}

/**
 * Loosely parse GET /api/collab/status `data` (tolerates partial payloads).
 */
export function parseCollabStatusData(input: unknown): CollabStatusData | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const out: CollabStatusData = {};
  if (typeof o.bus === 'string' && !/[\0\r\n]/.test(o.bus)) out.bus = o.bus.trim().slice(0, 64);
  if (typeof o.nodeId === 'string' && !/[\0\r\n]/.test(o.nodeId)) {
    out.nodeId = o.nodeId.trim().slice(0, 128);
  }
  if (typeof o.ready === 'boolean') out.ready = o.ready;
  if (o.detail === null) out.detail = null;
  else if (typeof o.detail === 'string' && !/[\0\r\n]/.test(o.detail)) {
    out.detail = o.detail.trim().slice(0, 500);
  }
  const parseReg = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const reg: { kind?: string; ready?: boolean; detail?: string | null } = {};
    if (typeof r.kind === 'string' && !/[\0\r\n]/.test(r.kind)) {
      reg.kind = r.kind.trim().slice(0, 64);
    }
    if (typeof r.ready === 'boolean') reg.ready = r.ready;
    if (r.detail === null) reg.detail = null;
    else if (typeof r.detail === 'string' && !/[\0\r\n]/.test(r.detail)) {
      reg.detail = r.detail.trim().slice(0, 500);
    }
    return reg;
  };
  const presence = parseReg(o.presence);
  if (presence) out.presence = presence;
  const locks = parseReg(o.locks);
  if (locks) out.locks = locks;
  if (o.sharedEdit && typeof o.sharedEdit === 'object' && !Array.isArray(o.sharedEdit)) {
    const se = o.sharedEdit as Record<string, unknown>;
    out.sharedEdit = {
      hardEnforce: typeof se.hardEnforce === 'boolean' ? se.hardEnforce : undefined,
      agentsHardEnforce:
        typeof se.agentsHardEnforce === 'boolean' ? se.agentsHardEnforce : undefined,
    };
  }
  return out;
}
