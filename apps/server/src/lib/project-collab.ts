/**
 * In-process project collaboration presence hub (v0.6 M0–M1).
 * Powers GET /api/projects/:id/collab/stream — presence.sync / join / leave.
 * Ephemeral only; no disk persistence. Disk files remain SSOT for content.
 *
 * M1: lastSeen + idle sweep; peer list includes stable colorHint for avatars.
 */

import { randomBytes } from 'node:crypto';

export type PresencePeer = {
  sessionId: string;
  displayName: string;
  joinedAt: string;
  /** Stable hue 0–359 for avatar chrome (derived from sessionId). */
  colorHint: number;
  lastSeen?: string;
};

export type CollabEvent =
  | { type: 'presence.sync'; projectId: string; self: PresencePeer; peers: PresencePeer[]; ts: string }
  | { type: 'presence.join'; projectId: string; peer: PresencePeer; ts: string }
  | { type: 'presence.leave'; projectId: string; sessionId: string; reason?: 'leave' | 'idle' | 'evicted'; ts: string };

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
const MAX_PEERS_PER_PROJECT = 32;
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

function broadcast(projectId: string, event: CollabEvent, exceptSessionId?: string): void {
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

/** Test helper — clear all rooms. */
export function clearProjectPresence(): void {
  rooms.clear();
}
