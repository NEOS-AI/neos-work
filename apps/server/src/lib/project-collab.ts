/**
 * In-process project collaboration presence hub (v0.6.0 M0).
 * Powers GET /api/projects/:id/collab/stream — presence.sync / join / leave.
 * Ephemeral only; no disk persistence. Disk files remain SSOT for content.
 */

import { randomBytes } from 'node:crypto';

export type PresencePeer = {
  sessionId: string;
  displayName: string;
  joinedAt: string;
};

export type CollabEvent =
  | { type: 'presence.sync'; projectId: string; self: PresencePeer; peers: PresencePeer[]; ts: string }
  | { type: 'presence.join'; projectId: string; peer: PresencePeer; ts: string }
  | { type: 'presence.leave'; projectId: string; sessionId: string; ts: string };

type RoomListener = (event: CollabEvent) => void;

type Session = {
  sessionId: string;
  displayName: string;
  joinedAt: string;
  listener: RoomListener;
};

const rooms = new Map<string, Map<string, Session>>();
const MAX_PEERS_PER_PROJECT = 32;

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

function peerPublic(s: Session): PresencePeer {
  return {
    sessionId: s.sessionId,
    displayName: s.displayName,
    joinedAt: s.joinedAt,
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

export function joinProjectPresence(input: {
  projectId: string;
  displayName?: string;
  listener: RoomListener;
}): { sessionId: string; unsub: () => void; sync: CollabEvent } | null {
  const projectId = normalizeProjectId(input.projectId);
  if (!projectId) return null;

  let room = rooms.get(projectId);
  if (!room) {
    room = new Map();
    rooms.set(projectId, room);
  }
  if (room.size >= MAX_PEERS_PER_PROJECT) {
    // Drop oldest by joinedAt
    let oldest: Session | null = null;
    for (const s of room.values()) {
      if (!oldest || s.joinedAt < oldest.joinedAt) oldest = s;
    }
    if (oldest) {
      room.delete(oldest.sessionId);
      try {
        oldest.listener({
          type: 'presence.leave',
          projectId,
          sessionId: oldest.sessionId,
          ts: new Date().toISOString(),
        });
      } catch {
        // ignore
      }
      broadcast(projectId, {
        type: 'presence.leave',
        projectId,
        sessionId: oldest.sessionId,
        ts: new Date().toISOString(),
      });
    }
  }

  const session: Session = {
    sessionId: newSessionId(),
    displayName: sanitizeDisplayName(input.displayName),
    joinedAt: new Date().toISOString(),
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

  const unsub = () => {
    const r = rooms.get(projectId);
    if (!r) return;
    if (!r.has(session.sessionId)) return;
    r.delete(session.sessionId);
    if (r.size === 0) rooms.delete(projectId);
    broadcast(projectId, {
      type: 'presence.leave',
      projectId,
      sessionId: session.sessionId,
      ts: new Date().toISOString(),
    });
  };

  return { sessionId: session.sessionId, unsub, sync };
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
