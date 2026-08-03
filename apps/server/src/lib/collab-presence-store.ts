/**
 * Shared presence membership (v0.8 M0).
 *
 * Local SSE sessions still live in project-collab `rooms` (need listeners).
 * This store tracks **all known peers** on this node: local + remote-mirrored
 * via CollabBus, so `presence.sync` / REST peers include multi-replica members.
 *
 * Ephemeral only — not disk SSOT.
 */

import type { PresencePeer } from './collab-types.js';

export type MembershipRecord = {
  peer: PresencePeer;
  /** Epoch ms last activity (join / heartbeat / touch). */
  lastSeenMs: number;
  /** True when this node does not own the SSE session. */
  remote: boolean;
};

/** Local idle (SSE session on this node). */
export const PRESENCE_LOCAL_IDLE_MS = 90_000;
/** Remote mirrored members expire if no heartbeat (≈3× local). */
export const PRESENCE_REMOTE_IDLE_MS = 270_000;
/** Min interval between bus heartbeats per session. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;

const MAX_MEMBERS_PER_PROJECT = 64;

/** projectId → sessionId → record */
const membership = new Map<string, Map<string, MembershipRecord>>();

function normalizeProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return '';
  const id = projectId.trim();
  if (!id || id.length > 128) return '';
  return id;
}

function normalizeSessionId(sessionId: string): string {
  if (typeof sessionId !== 'string' || /[\0\r\n]/.test(sessionId)) return '';
  const s = sessionId.trim();
  if (!s || s.length > 64) return '';
  return s;
}

function peerPublic(rec: MembershipRecord): PresencePeer {
  return {
    ...rec.peer,
    lastSeen: new Date(rec.lastSeenMs).toISOString(),
  };
}

export function upsertMembership(
  projectId: string,
  peer: PresencePeer,
  opts: { remote: boolean; lastSeenMs?: number },
): boolean {
  const pid = normalizeProjectId(projectId);
  const sid = normalizeSessionId(peer.sessionId);
  if (!pid || !sid) return false;

  let m = membership.get(pid);
  if (!m) {
    m = new Map();
    membership.set(pid, m);
  }

  const existing = m.get(sid);
  // Local ownership wins over remote mirror for same sessionId — only refresh TTL
  if (existing && !existing.remote && opts.remote) {
    existing.lastSeenMs = opts.lastSeenMs ?? Date.now();
    existing.peer.lastSeen = new Date(existing.lastSeenMs).toISOString();
    return true;
  }

  if (!existing && m.size >= MAX_MEMBERS_PER_PROJECT) {
    // Drop oldest remote first, else oldest overall
    let victim: string | null = null;
    let victimTs = Number.POSITIVE_INFINITY;
    for (const [id, rec] of m) {
      if (opts.remote && !rec.remote) continue;
      if (rec.lastSeenMs < victimTs) {
        victimTs = rec.lastSeenMs;
        victim = id;
      }
    }
    if (!victim) {
      for (const [id, rec] of m) {
        if (rec.lastSeenMs < victimTs) {
          victimTs = rec.lastSeenMs;
          victim = id;
        }
      }
    }
    if (victim) m.delete(victim);
  }

  const lastSeenMs = opts.lastSeenMs ?? Date.now();
  m.set(sid, {
    peer: {
      sessionId: sid,
      displayName: peer.displayName || 'Anonymous',
      joinedAt: peer.joinedAt || new Date(lastSeenMs).toISOString(),
      colorHint: typeof peer.colorHint === 'number' ? peer.colorHint % 360 : 0,
      lastSeen: new Date(lastSeenMs).toISOString(),
    },
    lastSeenMs,
    remote: opts.remote,
  });
  return true;
}

export function removeMembership(projectId: string, sessionId: string): boolean {
  const pid = normalizeProjectId(projectId);
  const sid = normalizeSessionId(sessionId);
  if (!pid || !sid) return false;
  const m = membership.get(pid);
  if (!m) return false;
  const ok = m.delete(sid);
  if (m.size === 0) membership.delete(pid);
  return ok;
}

export function touchMembership(projectId: string, sessionId: string): boolean {
  const pid = normalizeProjectId(projectId);
  const sid = normalizeSessionId(sessionId);
  if (!pid || !sid) return false;
  const rec = membership.get(pid)?.get(sid);
  if (!rec) return false;
  rec.lastSeenMs = Date.now();
  rec.peer.lastSeen = new Date(rec.lastSeenMs).toISOString();
  return true;
}

export function getMembership(projectId: string, sessionId: string): MembershipRecord | null {
  const pid = normalizeProjectId(projectId);
  const sid = normalizeSessionId(sessionId);
  if (!pid || !sid) return null;
  return membership.get(pid)?.get(sid) ?? null;
}

/** Peers known on this node (local + remote), optional exclude. */
export function listMembershipPeers(
  projectId: string,
  exceptSessionId?: string,
): PresencePeer[] {
  const pid = normalizeProjectId(projectId);
  if (!pid) return [];
  const m = membership.get(pid);
  if (!m) return [];
  const out: PresencePeer[] = [];
  for (const rec of m.values()) {
    if (exceptSessionId && rec.peer.sessionId === exceptSessionId) continue;
    out.push(peerPublic(rec));
  }
  out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return out;
}

export function membershipCount(projectId: string): number {
  const pid = normalizeProjectId(projectId);
  if (!pid) return 0;
  return membership.get(pid)?.size ?? 0;
}

/**
 * Drop idle members.
 * - Local records: only report candidates (caller forceLeave with bus).
 * - Remote records: remove here and return for local SSE leave delivery.
 */
export function sweepMembershipIdle(projectId?: string): {
  localIdle: Array<{ projectId: string; sessionId: string }>;
  remoteRemoved: Array<{ projectId: string; sessionId: string; peer: PresencePeer }>;
} {
  const now = Date.now();
  const localIdle: Array<{ projectId: string; sessionId: string }> = [];
  const remoteRemoved: Array<{ projectId: string; sessionId: string; peer: PresencePeer }> = [];
  const ids = projectId
    ? [normalizeProjectId(projectId)].filter(Boolean)
    : [...membership.keys()];

  for (const pid of ids) {
    const m = membership.get(pid);
    if (!m) continue;
    for (const [sid, rec] of [...m.entries()]) {
      const limit = rec.remote ? PRESENCE_REMOTE_IDLE_MS : PRESENCE_LOCAL_IDLE_MS;
      if (now - rec.lastSeenMs <= limit) continue;
      if (rec.remote) {
        m.delete(sid);
        remoteRemoved.push({ projectId: pid, sessionId: sid, peer: peerPublic(rec) });
      } else {
        localIdle.push({ projectId: pid, sessionId: sid });
      }
    }
    if (m.size === 0) membership.delete(pid);
  }
  return { localIdle, remoteRemoved };
}

/** Test helper. */
export function clearMembershipStore(): void {
  membership.clear();
}
