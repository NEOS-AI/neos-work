/**
 * Optional Redis file-lock registry (v0.10 M1) — thin config over collab-ttl-registry.
 *
 * Keys:
 *   neos:collab:lock:{projectId}:{path}     SET EX ttl  (JSON FileLock)
 *   neos:collab:locks:{projectId}           SET of paths
 */

import type { FileLock } from './collab-types.js';
import {
  COLLAB_REGISTRY_TTL_SEC,
  createTtlJsonRegistry,
  resolveRegistryMode,
  type RegistryKind,
  type RegistryStatus,
  type TtlJsonRegistry,
} from './collab-ttl-registry.js';

export type LockRegistryKind = RegistryKind;
export type LockRegistryStatus = RegistryStatus;
export type LockRegistry = TtlJsonRegistry<FileLock>;

export function resolveLockRegistryMode(
  env: NodeJS.ProcessEnv = process.env,
): 'off' | 'memory' | 'redis' | 'auto' {
  return resolveRegistryMode(env, 'NEOS_COLLAB_LOCKS');
}

function parseLock(raw: string): FileLock | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.path !== 'string' || /[\0\r\n]/.test(o.path)) return null;
    if (typeof o.sessionId !== 'string' || /[\0\r\n]/.test(o.sessionId)) return null;
    if (typeof o.displayName !== 'string') return null;
    const path = o.path.trim();
    const sessionId = o.sessionId.trim();
    if (!path || path.length > 512 || !sessionId || sessionId.length > 64) return null;
    return {
      path,
      sessionId: sessionId.slice(0, 64),
      displayName: o.displayName.trim().slice(0, 48) || 'Anonymous',
      acquiredAt: typeof o.acquiredAt === 'string' ? o.acquiredAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function createLockRegistry(env: NodeJS.ProcessEnv = process.env): LockRegistry {
  return createTtlJsonRegistry<FileLock>(
    {
      label: 'locks',
      modeEnvKey: 'NEOS_COLLAB_LOCKS',
      ttlSec: COLLAB_REGISTRY_TTL_SEC,
      itemKey: (pid, path) => `neos:collab:lock:${pid}:${path}`,
      setKey: (pid) => `neos:collab:locks:${pid}`,
      memberId: (lock) => lock.path,
      memberIdMaxLen: 512,
      serialize: (lock) =>
        JSON.stringify({
          path: lock.path,
          sessionId: lock.sessionId,
          displayName: lock.displayName,
          acquiredAt: lock.acquiredAt,
        }),
      parse: parseLock,
      sortList: (a, b) => a.path.localeCompare(b.path),
      memoryDetail: 'in-process locks only (no Redis registry)',
    },
    env,
  );
}

let registry: LockRegistry | null = null;

export function getLockRegistry(): LockRegistry {
  if (!registry) registry = createLockRegistry();
  return registry;
}

export function initLockRegistry(env: NodeJS.ProcessEnv = process.env): LockRegistry {
  if (registry) {
    void registry.close();
    registry = null;
  }
  registry = createLockRegistry(env);
  return registry;
}

export function shutdownLockRegistry(): void {
  if (registry) {
    void registry.close();
    registry = null;
  }
}

export function resetLockRegistryForTests(): void {
  shutdownLockRegistry();
}

export function setLockRegistryForTests(r: LockRegistry | null): void {
  registry = r;
}

export { COLLAB_REGISTRY_TTL_SEC as LOCK_REDIS_TTL_SEC };
