/**
 * In-process file locks + optional Redis dual-write (v0.10 M1).
 *
 * Mirrors collab-presence-store: local map is authoritative for this node;
 * registry hydrate is **fill-missing only** and respects release tombstones
 * so fire-and-forget lag cannot resurrect a just-released lock.
 */

import { normalizeProjectRelPath } from '@neos-work/shared';
import { getLockRegistry } from './collab-locks-redis.js';
import type { FileLock } from './collab-types.js';

export const MAX_LOCKS_PER_PROJECT = 64;
/** Suppress registry re-hydration of a path after local release. */
const RELEASE_TOMBSTONE_MS = 8_000;

type LockRecord = {
  lock: FileLock;
  /** local = this node acquired; remote = bus or registry hydrate. */
  origin: 'local' | 'remote';
};

/** projectId → path → record */
const lockRooms = new Map<string, Map<string, LockRecord>>();
/** projectId → path → tombstone expiry ms */
const releaseTombstones = new Map<string, Map<string, number>>();

function normalizeProjectId(projectId: string): string {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return '';
  const id = projectId.trim();
  if (!id || id.length > 128) return '';
  return id;
}

export const normalizeLockPath = normalizeProjectRelPath;

function setTombstone(projectId: string, path: string): void {
  let m = releaseTombstones.get(projectId);
  if (!m) {
    m = new Map();
    releaseTombstones.set(projectId, m);
  }
  m.set(path, Date.now() + RELEASE_TOMBSTONE_MS);
}

function hasActiveTombstone(projectId: string, path: string): boolean {
  const until = releaseTombstones.get(projectId)?.get(path);
  if (until == null) return false;
  if (Date.now() > until) {
    releaseTombstones.get(projectId)?.delete(path);
    return false;
  }
  return true;
}

function clearTombstone(projectId: string, path: string): void {
  const m = releaseTombstones.get(projectId);
  if (!m) return;
  m.delete(path);
  if (m.size === 0) releaseTombstones.delete(projectId);
}

async function dualWritePut(projectId: string, lock: FileLock): Promise<void> {
  try {
    await getLockRegistry().put(projectId, lock);
  } catch {
    /* registry optional */
  }
}

async function dualWriteDel(projectId: string, path: string): Promise<void> {
  try {
    await getLockRegistry().del(projectId, path);
  } catch {
    /* ignore */
  }
}

async function dualWriteTouch(projectId: string, lock: FileLock): Promise<void> {
  try {
    await getLockRegistry().touch(projectId, lock.path, lock);
  } catch {
    /* ignore */
  }
}

export function listStoredLocks(projectId: string): FileLock[] {
  const pid = normalizeProjectId(projectId);
  if (!pid) return [];
  const m = lockRooms.get(pid);
  if (!m) return [];
  return [...m.values()].map((r) => r.lock).sort((a, b) => a.path.localeCompare(b.path));
}

export function getStoredLock(projectId: string, path: string): FileLock | null {
  const pid = normalizeProjectId(projectId);
  const p = normalizeLockPath(path);
  if (!pid || !p) return null;
  return lockRooms.get(pid)?.get(p)?.lock ?? null;
}

/** Apply lock from bus without dual-write (origin already wrote registry). */
export function applyRemoteLockAcquired(projectId: string, lock: FileLock): void {
  const pid = normalizeProjectId(projectId);
  const path = normalizeLockPath(lock.path);
  if (!pid || !path) return;
  clearTombstone(pid, path);
  let m = lockRooms.get(pid);
  if (!m) {
    m = new Map();
    lockRooms.set(pid, m);
  }
  m.set(path, {
    lock: {
      path,
      sessionId: lock.sessionId,
      displayName: lock.displayName || 'Anonymous',
      acquiredAt: lock.acquiredAt || new Date().toISOString(),
    },
    origin: 'remote',
  });
}

/** Apply lock release from bus without dual-write. */
export function applyRemoteLockReleased(projectId: string, path: string): void {
  const pid = normalizeProjectId(projectId);
  const p = normalizeLockPath(path);
  if (!pid || !p) return;
  const m = lockRooms.get(pid);
  if (!m) return;
  m.delete(p);
  if (m.size === 0) lockRooms.delete(pid);
}

/**
 * Put a local lock (acquire/re-acquire). Awaits registry dual-write.
 * Caller must already have hydrated when multi-replica matters.
 */
export async function putLocalLock(projectId: string, lock: FileLock): Promise<void> {
  const pid = normalizeProjectId(projectId);
  const path = normalizeLockPath(lock.path);
  if (!pid || !path) return;
  clearTombstone(pid, path);
  let m = lockRooms.get(pid);
  if (!m) {
    m = new Map();
    lockRooms.set(pid, m);
  }
  const existing = m.get(path);
  const stored: FileLock = {
    path,
    sessionId: lock.sessionId,
    displayName: lock.displayName || 'Anonymous',
    acquiredAt: existing?.lock.acquiredAt ?? lock.acquiredAt ?? new Date().toISOString(),
  };
  m.set(path, { lock: stored, origin: 'local' });
  if (existing) {
    await dualWriteTouch(pid, stored);
  } else {
    await dualWritePut(pid, stored);
  }
}

/**
 * Release a local lock. Tombstone + await registry del so hydrate cannot resurrect.
 */
export async function removeLocalLock(
  projectId: string,
  path: string,
): Promise<'ok' | 'missing' | 'not_holder' | 'invalid'> {
  const pid = normalizeProjectId(projectId);
  const p = normalizeLockPath(path);
  if (!pid || !p) return 'invalid';
  const m = lockRooms.get(pid);
  if (!m?.has(p)) {
    // Still tombstone + del for multi-replica consistency if we thought we held it
    return 'missing';
  }
  m.delete(p);
  if (m.size === 0) lockRooms.delete(pid);
  setTombstone(pid, p);
  await dualWriteDel(pid, p);
  return 'ok';
}

/**
 * Drop all locks for a session from memory + tombstone; dual-write del in background.
 * Returns released locks so the hub can broadcast synchronously on leave.
 */
export function releaseAllLocksForSessionMemory(
  projectId: string,
  sessionId: string,
): FileLock[] {
  const pid = normalizeProjectId(projectId);
  if (!pid) return [];
  const m = lockRooms.get(pid);
  if (!m) return [];
  const released: FileLock[] = [];
  for (const [path, rec] of [...m.entries()]) {
    if (rec.lock.sessionId !== sessionId) continue;
    m.delete(path);
    setTombstone(pid, path);
    released.push(rec.lock);
  }
  if (m.size === 0) lockRooms.delete(pid);
  void Promise.all(released.map((l) => dualWriteDel(pid, l.path)));
  return released;
}

/** Refresh Redis TTL for locks held by session (call on heartbeat, not every SSE tick). */
export async function touchLocksForSession(
  projectId: string,
  sessionId: string,
): Promise<void> {
  const pid = normalizeProjectId(projectId);
  if (!pid) return;
  const m = lockRooms.get(pid);
  if (!m) return;
  const held: FileLock[] = [];
  for (const rec of m.values()) {
    if (rec.lock.sessionId === sessionId) held.push(rec.lock);
  }
  await Promise.all(held.map((lock) => dualWriteTouch(pid, lock)));
}

/**
 * Pull locks from Redis into local map (v0.10 M1).
 * - Fill-missing only (never overwrite existing local entry)
 * - Skip active release tombstones
 * - Memory only (no write-back)
 */
export async function hydrateLocksFromRegistry(projectId: string): Promise<number> {
  const pid = normalizeProjectId(projectId);
  if (!pid) return 0;
  let locks: FileLock[] = [];
  try {
    locks = await getLockRegistry().list(pid);
  } catch {
    return 0;
  }
  let added = 0;
  for (const lock of locks) {
    const path = normalizeLockPath(lock.path);
    if (!path) continue;
    if (typeof lock.sessionId !== 'string' || /[\0\r\n]/.test(lock.sessionId)) continue;
    const sessionId = lock.sessionId.trim();
    if (!sessionId || sessionId.length > 64) continue;
    if (hasActiveTombstone(pid, path)) continue;
    let m = lockRooms.get(pid);
    if (!m) {
      m = new Map();
      lockRooms.set(pid, m);
    }
    if (m.has(path)) continue; // local/bus wins
    m.set(path, {
      lock: {
        path,
        sessionId,
        displayName: lock.displayName || 'Anonymous',
        acquiredAt: lock.acquiredAt || new Date().toISOString(),
      },
      origin: 'remote',
    });
    added++;
  }
  return added;
}

export function lockCount(projectId: string): number {
  const pid = normalizeProjectId(projectId);
  if (!pid) return 0;
  return lockRooms.get(pid)?.size ?? 0;
}

/** Test helper. */
export function clearLockStore(): void {
  lockRooms.clear();
  releaseTombstones.clear();
}
