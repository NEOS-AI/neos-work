/**
 * In-process project collaboration presence + file locks + selection (v0.6–v0.7).
 * Powers GET /api/projects/:id/collab/stream — presence.* / lock.* / selection.*.
 * Ephemeral only; no disk persistence. Disk files remain SSOT for content.
 *
 * M1: lastSeen + idle sweep; peer list includes stable colorHint for avatars.
 * M3: advisory file locks (ADR 0001 — lock+LWW spike).
 * v0.7 M1: fan-out via CollabBus (memory default; redis optional).
 * v0.7 M2: selection awareness (path + selector) for peer indicators.
 */

import { randomBytes } from 'node:crypto';
import { getCollabBus, isCollabBusFanoutEvent } from './collab-bus.js';
import type { CollabEvent, FileLock, PeerSelection, PresencePeer } from './collab-types.js';

export type { CollabEvent, FileLock, PeerSelection, PresencePeer } from './collab-types.js';

type RoomListener = (event: CollabEvent) => void;

type Session = {
  sessionId: string;
  displayName: string;
  joinedAt: string;
  lastSeen: number;
  colorHint: number;
  listener: RoomListener;
};

const rooms = new Map<string, Map<string, Session>>();
/** projectId → path → FileLock */
const lockRooms = new Map<string, Map<string, FileLock>>();
/** projectId → sessionId → PeerSelection (local + remote-mirrored) */
const selectionRooms = new Map<string, Map<string, PeerSelection>>();
const MAX_PEERS_PER_PROJECT = 32;
const MAX_LOCKS_PER_PROJECT = 64;
const MAX_SELECTIONS_PER_PROJECT = 64;
const MAX_SELECTOR_LEN = 400;
/** Drop sessions with no heartbeat / SSE activity (ms). */
export const PRESENCE_IDLE_MS = 90_000;

function normalizeProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return '';
  const id = projectId.trim();
  if (!id || id.length > 128) return '';
  return id;
}

/** Sanitize peer display label — no control chars, bounded length. */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'Anonymous';
  const t = raw.trim().replace(/[<>]/g, '').slice(0, 48);
  return t || 'Anonymous';
}

function newSessionId(): string {
  return randomBytes(12).toString('hex');
}

/** Normalize project-relative file path for locks (no .., no abs, bounded). */
export function normalizeLockPath(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  let p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.length > 500) return '';
  if (p.includes('..')) return '';
  if (p.startsWith('~/') || /^[A-Za-z]:\//.test(p)) return '';
  return p;
}

function listLocks(projectId: string): FileLock[] {
  const m = lockRooms.get(projectId);
  if (!m) return [];
  return [...m.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function listSelections(projectId: string): PeerSelection[] {
  const m = selectionRooms.get(projectId);
  if (!m) return [];
  return [...m.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

function clearSelectionForSession(
  projectId: string,
  sessionId: string,
  opts?: { broadcast?: boolean },
): void {
  const m = selectionRooms.get(projectId);
  if (!m) return;
  const prev = m.get(sessionId);
  if (!prev) return;
  m.delete(sessionId);
  if (m.size === 0) selectionRooms.delete(projectId);
  if (opts?.broadcast === false) return;
  const cleared: PeerSelection = {
    sessionId: prev.sessionId,
    displayName: prev.displayName,
    colorHint: prev.colorHint,
    path: null,
    selector: null,
    layerId: null,
    updatedAt: new Date().toISOString(),
  };
  broadcast(projectId, {
    type: 'selection.changed',
    projectId,
    selection: cleared,
    ts: cleared.updatedAt,
  });
}

function releaseAllLocksForSession(projectId: string, sessionId: string): void {
  const m = lockRooms.get(projectId);
  if (!m) return;
  for (const [path, lock] of [...m.entries()]) {
    if (lock.sessionId !== sessionId) continue;
    m.delete(path);
    broadcast(projectId, {
      type: 'lock.released',
      projectId,
      path,
      sessionId,
      ts: new Date().toISOString(),
    });
  }
  if (m.size === 0) lockRooms.delete(projectId);
}

/** Sanitize CSS/layer selector for awareness (no control chars, bounded). */
export function sanitizeSelector(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const t = raw.trim().slice(0, MAX_SELECTOR_LEN);
  return t || null;
}

/** Sanitize optional layer id. */
export function sanitizeLayerId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const t = raw.trim().slice(0, 128);
  return t || null;
}

/** Stable 0–359 from session id for avatar colors. */
export function colorHintFromSessionId(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) {
    h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function peerPublic(s: Session): PresencePeer {
  return {
    sessionId: s.sessionId,
    displayName: s.displayName,
    joinedAt: s.joinedAt,
    colorHint: s.colorHint,
    lastSeen: new Date(s.lastSeen).toISOString(),
  };
}

function listPeers(projectId: string, exceptSessionId?: string): PresencePeer[] {
  const room = rooms.get(projectId);
  if (!room) return [];
  const out: PresencePeer[] = [];
  for (const s of room.values()) {
    if (exceptSessionId && s.sessionId === exceptSessionId) continue;
    out.push(peerPublic(s));
  }
  // Stable order for UI
  out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return out;
}

/** Deliver to local SSE listeners only (no bus republish). */
export function deliverCollabEventLocal(
  projectId: string,
  event: CollabEvent,
  exceptSessionId?: string,
): void {
  const room = rooms.get(projectId);
  if (!room) return;
  for (const s of room.values()) {
    if (exceptSessionId && s.sessionId === exceptSessionId) continue;
    try {
      s.listener(event);
    } catch {
      // never break hub
    }
  }
}

function broadcast(
  projectId: string,
  event: CollabEvent,
  exceptSessionId?: string,
  opts?: { skipBus?: boolean },
): void {
  deliverCollabEventLocal(projectId, event, exceptSessionId);
  if (opts?.skipBus) return;
  if (!isCollabBusFanoutEvent(event)) return;
  try {
    void getCollabBus().publish(projectId, event);
  } catch {
    // bus optional
  }
}

/**
 * Apply a remote bus event on this node (locks/selections + local listeners).
 * Does not re-publish to the bus.
 */
export function applyRemoteCollabEvent(projectId: string, event: CollabEvent): void {
  const id = normalizeProjectId(projectId);
  if (!id) return;

  if (event.type === 'lock.acquired' && event.lock) {
    let m = lockRooms.get(id);
    if (!m) {
      m = new Map();
      lockRooms.set(id, m);
    }
    m.set(event.lock.path, event.lock);
  } else if (event.type === 'lock.released' && event.path) {
    const m = lockRooms.get(id);
    if (m) {
      m.delete(event.path);
      if (m.size === 0) lockRooms.delete(id);
    }
  } else if (event.type === 'selection.changed' && event.selection) {
    const sel = event.selection;
    let m = selectionRooms.get(id);
    if (!m) {
      m = new Map();
      selectionRooms.set(id, m);
    }
    if (sel.path == null && sel.selector == null) {
      m.delete(sel.sessionId);
      if (m.size === 0) selectionRooms.delete(id);
    } else {
      if (!m.has(sel.sessionId) && m.size >= MAX_SELECTIONS_PER_PROJECT) {
        // drop oldest by updatedAt
        let oldestId: string | null = null;
        let oldestTs = '';
        for (const [sid, s] of m) {
          if (!oldestId || s.updatedAt < oldestTs) {
            oldestId = sid;
            oldestTs = s.updatedAt;
          }
        }
        if (oldestId) m.delete(oldestId);
      }
      m.set(sel.sessionId, sel);
    }
  } else if (event.type === 'presence.leave' && event.sessionId) {
    const m = selectionRooms.get(id);
    if (m) {
      m.delete(event.sessionId);
      if (m.size === 0) selectionRooms.delete(id);
    }
  }
  // Presence join/leave from remote: we only mirror to local listeners for UX;
  // remote peers are not in local `rooms` (no SSE session on this node).
  deliverCollabEventLocal(id, event);
}

function forceLeave(
  projectId: string,
  sessionId: string,
  reason: 'leave' | 'idle' | 'evicted',
): void {
  const room = rooms.get(projectId);
  if (!room) return;
  const s = room.get(sessionId);
  if (!s) return;
  room.delete(sessionId);
  if (room.size === 0) rooms.delete(projectId);
  releaseAllLocksForSession(projectId, sessionId);
  clearSelectionForSession(projectId, sessionId, { broadcast: false });
  const ev: CollabEvent = {
    type: 'presence.leave',
    projectId,
    sessionId,
    reason,
    ts: new Date().toISOString(),
  };
  try {
    s.listener(ev);
  } catch {
    // ignore
  }
  broadcast(projectId, ev);
}

export function joinProjectPresence(input: {
  projectId: string;
  displayName?: string;
  listener: RoomListener;
}): { sessionId: string; unsub: () => void; sync: CollabEvent; touch: () => void } | null {
  const projectId = normalizeProjectId(input.projectId);
  if (!projectId) return null;

  // Opportunistic idle sweep on join
  sweepIdlePresence(projectId);

  let room = rooms.get(projectId);
  if (!room) {
    room = new Map();
    rooms.set(projectId, room);
  }
  if (room.size >= MAX_PEERS_PER_PROJECT) {
    let oldest: Session | null = null;
    for (const s of room.values()) {
      if (!oldest || s.joinedAt < oldest.joinedAt) oldest = s;
    }
    if (oldest) forceLeave(projectId, oldest.sessionId, 'evicted');
    room = rooms.get(projectId) ?? new Map();
    rooms.set(projectId, room);
  }

  const sessionId = newSessionId();
  const now = Date.now();
  const session: Session = {
    sessionId,
    displayName: sanitizeDisplayName(input.displayName),
    joinedAt: new Date(now).toISOString(),
    lastSeen: now,
    colorHint: colorHintFromSessionId(sessionId),
    listener: input.listener,
  };
  room.set(session.sessionId, session);

  const ts = new Date().toISOString();
  const sync: CollabEvent = {
    type: 'presence.sync',
    projectId,
    self: peerPublic(session),
    peers: listPeers(projectId, session.sessionId),
    locks: listLocks(projectId),
    selections: listSelections(projectId).filter((s) => s.sessionId !== session.sessionId),
    ts,
  };

  broadcast(
    projectId,
    {
      type: 'presence.join',
      projectId,
      peer: peerPublic(session),
      ts,
    },
    session.sessionId,
  );

  const touch = () => {
    const r = rooms.get(projectId);
    const s = r?.get(sessionId);
    if (s) s.lastSeen = Date.now();
  };

  const unsub = () => {
    const r = rooms.get(projectId);
    if (!r?.has(sessionId)) return;
    forceLeave(projectId, sessionId, 'leave');
  };

  return { sessionId, unsub, sync, touch };
}

/** Client heartbeat — keeps idle sweep from dropping the session. */
export function touchProjectPresence(projectId: string, sessionId: string): boolean {
  const id = normalizeProjectId(projectId);
  if (!id || typeof sessionId !== 'string' || /[\0\r\n]/.test(sessionId)) return false;
  const sid = sessionId.trim();
  if (!sid || sid.length > 64) return false;
  const s = rooms.get(id)?.get(sid);
  if (!s) return false;
  s.lastSeen = Date.now();
  return true;
}

/** Remove sessions idle longer than PRESENCE_IDLE_MS. */
export function sweepIdlePresence(projectId?: string): number {
  const now = Date.now();
  let removed = 0;
  const ids = projectId
    ? [normalizeProjectId(projectId)].filter(Boolean)
    : [...rooms.keys()];
  for (const pid of ids) {
    const room = rooms.get(pid);
    if (!room) continue;
    for (const s of [...room.values()]) {
      if (now - s.lastSeen > PRESENCE_IDLE_MS) {
        forceLeave(pid, s.sessionId, 'idle');
        removed++;
      }
    }
  }
  return removed;
}

export function listProjectPeers(projectId: string): PresencePeer[] {
  const id = normalizeProjectId(projectId);
  if (!id) return [];
  return listPeers(id);
}

export function projectPresenceCount(projectId: string): number {
  const id = normalizeProjectId(projectId);
  if (!id) return 0;
  return rooms.get(id)?.size ?? 0;
}

/**
 * Acquire advisory lock on a project file path.
 * Same session may re-acquire (refresh). Other session → conflict.
 */
export function acquireFileLock(input: {
  projectId: string;
  sessionId: string;
  path: string;
}): { ok: true; lock: FileLock } | { ok: false; error: string; holder?: FileLock } {
  const projectId = normalizeProjectId(input.projectId);
  const path = normalizeLockPath(input.path);
  if (!projectId || !path) return { ok: false, error: 'Invalid project or path' };
  if (typeof input.sessionId !== 'string' || /[\0\r\n]/.test(input.sessionId)) {
    return { ok: false, error: 'Invalid session' };
  }
  const sessionId = input.sessionId.trim();
  const session = rooms.get(projectId)?.get(sessionId);
  if (!session) return { ok: false, error: 'Session not in presence room' };

  let m = lockRooms.get(projectId);
  if (!m) {
    m = new Map();
    lockRooms.set(projectId, m);
  }
  const existing = m.get(path);
  if (existing && existing.sessionId !== sessionId) {
    return { ok: false, error: 'Locked by another session', holder: existing };
  }
  if (!existing && m.size >= MAX_LOCKS_PER_PROJECT) {
    return { ok: false, error: 'Too many locks on project' };
  }

  const lock: FileLock = {
    path,
    sessionId,
    displayName: session.displayName,
    acquiredAt: existing?.acquiredAt ?? new Date().toISOString(),
  };
  m.set(path, lock);
  broadcast(projectId, {
    type: 'lock.acquired',
    projectId,
    lock,
    ts: new Date().toISOString(),
  });
  return { ok: true, lock };
}

export function releaseFileLock(input: {
  projectId: string;
  sessionId: string;
  path: string;
}): { ok: true } | { ok: false; error: string } {
  const projectId = normalizeProjectId(input.projectId);
  const path = normalizeLockPath(input.path);
  if (!projectId || !path) return { ok: false, error: 'Invalid project or path' };
  if (typeof input.sessionId !== 'string' || /[\0\r\n]/.test(input.sessionId)) {
    return { ok: false, error: 'Invalid session' };
  }
  const sessionId = input.sessionId.trim();
  const m = lockRooms.get(projectId);
  const existing = m?.get(path);
  if (!existing) return { ok: true }; // idempotent
  if (existing.sessionId !== sessionId) {
    return { ok: false, error: 'Not lock holder' };
  }
  m!.delete(path);
  if (m!.size === 0) lockRooms.delete(projectId);
  broadcast(projectId, {
    type: 'lock.released',
    projectId,
    path,
    sessionId,
    ts: new Date().toISOString(),
  });
  return { ok: true };
}

export function listProjectLocks(projectId: string): FileLock[] {
  const id = normalizeProjectId(projectId);
  if (!id) return [];
  return listLocks(id);
}

/** Who holds a lock on path, if any. */
export function getFileLock(projectId: string, path: string): FileLock | null {
  const id = normalizeProjectId(projectId);
  const p = normalizeLockPath(path);
  if (!id || !p) return null;
  return lockRooms.get(id)?.get(p) ?? null;
}

/**
 * Publish (or clear) the session's editing selection for peer awareness (v0.7 M2).
 * `path` / `selector` null or empty → clear that field; both null → clear selection.
 * Same session may update freely; no exclusive claim (unlike file locks).
 */
export function setSessionSelection(input: {
  projectId: string;
  sessionId: string;
  path?: string | null;
  selector?: string | null;
  layerId?: string | null;
}): { ok: true; selection: PeerSelection } | { ok: false; error: string } {
  const projectId = normalizeProjectId(input.projectId);
  if (!projectId) return { ok: false, error: 'Invalid project' };
  if (typeof input.sessionId !== 'string' || /[\0\r\n]/.test(input.sessionId)) {
    return { ok: false, error: 'Invalid session' };
  }
  const sessionId = input.sessionId.trim();
  if (!sessionId || sessionId.length > 64) return { ok: false, error: 'Invalid session' };

  const session = rooms.get(projectId)?.get(sessionId);
  if (!session) return { ok: false, error: 'Session not in presence room' };

  // path: null/undefined/'' → null; otherwise normalizeLockPath
  let path: string | null = null;
  if (input.path != null && input.path !== '') {
    path = normalizeLockPath(input.path);
    if (!path) return { ok: false, error: 'Invalid path' };
  }
  const selector = sanitizeSelector(input.selector ?? null);
  const layerId = sanitizeLayerId(input.layerId ?? null);

  const updatedAt = new Date().toISOString();
  const selection: PeerSelection = {
    sessionId,
    displayName: session.displayName,
    colorHint: session.colorHint,
    path,
    selector,
    layerId,
    updatedAt,
  };

  let m = selectionRooms.get(projectId);
  if (!m) {
    m = new Map();
    selectionRooms.set(projectId, m);
  }

  if (path == null && selector == null) {
    m.delete(sessionId);
    if (m.size === 0) selectionRooms.delete(projectId);
  } else {
    if (!m.has(sessionId) && m.size >= MAX_SELECTIONS_PER_PROJECT) {
      return { ok: false, error: 'Too many selections on project' };
    }
    m.set(sessionId, selection);
  }

  // Touch presence so selection activity keeps session alive
  session.lastSeen = Date.now();

  broadcast(projectId, {
    type: 'selection.changed',
    projectId,
    selection,
    ts: updatedAt,
  });
  return { ok: true, selection };
}

export function listProjectSelections(projectId: string): PeerSelection[] {
  const id = normalizeProjectId(projectId);
  if (!id) return [];
  return listSelections(id);
}

/** When true, file PUT rejects writers who do not hold the lock (if a lock exists). */
export function isSharedEditHardEnforce(): boolean {
  const v = process.env.NEOS_SHARED_EDIT;
  return v === '1' || v === 'true';
}

/** Test helper — clear all rooms, locks, and selections. */
export function clearProjectPresence(): void {
  rooms.clear();
  lockRooms.clear();
  selectionRooms.clear();
}
