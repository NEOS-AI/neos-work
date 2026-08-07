/**
 * Optional Redis presence registry (v0.8 M1) — thin config over collab-ttl-registry.
 *
 * Keys:
 *   neos:collab:presence:peer:{projectId}:{sessionId}  SET EX ttl
 *   neos:collab:presence:members:{projectId}            SET of sessionIds
 */

import type { PresencePeer } from './collab-types.js';
import {
  COLLAB_REGISTRY_TTL_SEC,
  createTtlJsonRegistry,
  resolveRegistryMode,
  type RegistryKind,
  type RegistryStatus,
  type TtlJsonRegistry,
} from './collab-ttl-registry.js';

export type PresenceRegistryKind = RegistryKind;
export type PresenceRegistryStatus = RegistryStatus;
export type PresenceRegistry = TtlJsonRegistry<PresencePeer>;

export function resolvePresenceRegistryMode(
  env: NodeJS.ProcessEnv = process.env,
): 'off' | 'memory' | 'redis' | 'auto' {
  return resolveRegistryMode(env, 'NEOS_COLLAB_PRESENCE');
}

function parsePeer(raw: string): PresencePeer | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.sessionId !== 'string' || /[\0\r\n]/.test(o.sessionId)) return null;
    if (typeof o.displayName !== 'string') return null;
    const colorHint =
      typeof o.colorHint === 'number' && Number.isFinite(o.colorHint) ? o.colorHint % 360 : 0;
    return {
      sessionId: o.sessionId.trim().slice(0, 64),
      displayName: o.displayName.trim().slice(0, 48) || 'Anonymous',
      joinedAt: typeof o.joinedAt === 'string' ? o.joinedAt : new Date().toISOString(),
      colorHint,
      lastSeen: typeof o.lastSeen === 'string' ? o.lastSeen : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function createPresenceRegistry(env: NodeJS.ProcessEnv = process.env): PresenceRegistry {
  return createTtlJsonRegistry<PresencePeer>(
    {
      label: 'presence',
      modeEnvKey: 'NEOS_COLLAB_PRESENCE',
      ttlSec: COLLAB_REGISTRY_TTL_SEC,
      itemKey: (pid, sid) => `neos:collab:presence:peer:${pid}:${sid}`,
      setKey: (pid) => `neos:collab:presence:members:${pid}`,
      memberId: (peer) => peer.sessionId,
      memberIdMaxLen: 64,
      serialize: (peer) =>
        JSON.stringify({
          sessionId: peer.sessionId,
          displayName: peer.displayName,
          joinedAt: peer.joinedAt,
          colorHint: peer.colorHint,
          lastSeen: peer.lastSeen ?? new Date().toISOString(),
        }),
      parse: parsePeer,
      sortList: (a, b) => a.joinedAt.localeCompare(b.joinedAt),
      memoryDetail: 'in-process membership only (no Redis registry)',
    },
    env,
  );
}

let registry: PresenceRegistry | null = null;

export function getPresenceRegistry(): PresenceRegistry {
  if (!registry) registry = createPresenceRegistry();
  return registry;
}

export function initPresenceRegistry(env: NodeJS.ProcessEnv = process.env): PresenceRegistry {
  if (registry) {
    void registry.close();
    registry = null;
  }
  registry = createPresenceRegistry(env);
  return registry;
}

export function shutdownPresenceRegistry(): void {
  if (registry) {
    void registry.close();
    registry = null;
  }
}

export function resetPresenceRegistryForTests(): void {
  shutdownPresenceRegistry();
}

export function setPresenceRegistryForTests(r: PresenceRegistry | null): void {
  registry = r;
}

export { COLLAB_REGISTRY_TTL_SEC as PRESENCE_REDIS_TTL_SEC };
