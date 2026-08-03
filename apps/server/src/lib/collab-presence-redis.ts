/**
 * Optional Redis presence registry (v0.8 M1).
 *
 * Stores per-session peer JSON with TTL so multi-replica nodes can hydrate
 * membership on join without relying solely on bus event order.
 *
 * Keys:
 *   neos:collab:presence:peer:{projectId}:{sessionId}  SET EX ttl
 *   neos:collab:presence:members:{projectId}            SET of sessionIds
 *
 * No hard dependency on `redis` — dynamic import; stub when unavailable.
 */

import type { PresencePeer } from './collab-types.js';
import { resolveCollabRedisUrl } from './collab-redis-url.js';

export type PresenceRegistryKind = 'off' | 'memory' | 'redis' | 'redis-stub';

export type PresenceRegistryStatus = {
  kind: PresenceRegistryKind;
  ready: boolean;
  detail?: string;
};

export interface PresenceRegistry {
  readonly kind: PresenceRegistryKind;
  put(projectId: string, peer: PresencePeer): void | Promise<void>;
  del(projectId: string, sessionId: string): void | Promise<void>;
  /** Refresh TTL; optionally rewrite peer payload when provided. */
  touch(projectId: string, sessionId: string, peer?: PresencePeer): void | Promise<void>;
  list(projectId: string): Promise<PresencePeer[]>;
  status(): PresenceRegistryStatus;
  close(): void | Promise<void>;
}

/** Match PRESENCE_REMOTE_IDLE_MS (270s) — keep in sync with collab-presence-store. */
const TTL_SEC = 270;

function peerKey(projectId: string, sessionId: string): string {
  return `neos:collab:presence:peer:${projectId}:${sessionId}`;
}

function membersKey(projectId: string): string {
  return `neos:collab:presence:members:${projectId}`;
}

function sanitizeIds(projectId: string, sessionId?: string): { pid: string; sid: string } | null {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return null;
  const pid = projectId.trim();
  if (!pid || pid.length > 128) return null;
  if (sessionId === undefined) return { pid, sid: '' };
  if (typeof sessionId !== 'string' || /[\0\r\n]/.test(sessionId)) return null;
  const sid = sessionId.trim();
  if (!sid || sid.length > 64) return null;
  return { pid, sid };
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

type RedisClientLike = {
  connect: () => Promise<unknown>;
  set: (key: string, value: string, opts?: { EX?: number }) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<unknown>;
  sAdd: (key: string, ...members: string[]) => Promise<unknown>;
  sRem: (key: string, ...members: string[]) => Promise<unknown>;
  sMembers: (key: string) => Promise<string[]>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  quit: () => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
};

function createOffRegistry(detail: string): PresenceRegistry {
  return {
    kind: 'off',
    put() {},
    del() {},
    touch() {},
    async list() {
      return [];
    },
    status: () => ({ kind: 'off', ready: true, detail }),
    close() {},
  };
}

function createMemoryNoopRegistry(): PresenceRegistry {
  return {
    kind: 'memory',
    put() {},
    del() {},
    touch() {},
    async list() {
      return [];
    },
    status: () => ({
      kind: 'memory',
      ready: true,
      detail: 'in-process membership only (no Redis registry)',
    }),
    close() {},
  };
}

function createRedisStub(detail: string): PresenceRegistry {
  return {
    kind: 'redis-stub',
    put() {},
    del() {},
    touch() {},
    async list() {
      return [];
    },
    status: () => ({ kind: 'redis-stub', ready: true, detail }),
    close() {},
  };
}

/**
 * Resolve presence registry mode.
 * - off: never use external registry
 * - memory: explicit in-process only
 * - redis: require redis URL + package
 * - auto (default): redis when NEOS_COLLAB_BUS=redis, else memory
 */
export function resolvePresenceRegistryMode(
  env: NodeJS.ProcessEnv = process.env,
): 'off' | 'memory' | 'redis' | 'auto' {
  const raw = (env.NEOS_COLLAB_PRESENCE ?? 'auto').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'memory') return 'memory';
  if (raw === 'redis') return 'redis';
  return 'auto';
}

export function createPresenceRegistry(env: NodeJS.ProcessEnv = process.env): PresenceRegistry {
  const mode = resolvePresenceRegistryMode(env);
  if (mode === 'off') {
    return createOffRegistry('NEOS_COLLAB_PRESENCE=off');
  }
  if (mode === 'memory') {
    return createMemoryNoopRegistry();
  }

  const busWantsRedis = (env.NEOS_COLLAB_BUS ?? 'memory').trim().toLowerCase() === 'redis';
  if (mode === 'auto' && !busWantsRedis) {
    return createMemoryNoopRegistry();
  }

  const url = resolveCollabRedisUrl(env);
  if (!url) {
    return createRedisStub(
      'presence registry wants redis but NEOS_COLLAB_REDIS_URL/REDIS_URL unset',
    );
  }

  let client: RedisClientLike | null = null;
  let ready = false;
  let detail = 'connecting…';
  let closed = false;

  const registry: PresenceRegistry = {
    kind: 'redis',
    put(projectId, peer) {
      const ids = sanitizeIds(projectId, peer.sessionId);
      if (!ids || !client || !ready) return;
      const { pid, sid } = ids;
      const payload = JSON.stringify({
        sessionId: sid,
        displayName: peer.displayName,
        joinedAt: peer.joinedAt,
        colorHint: peer.colorHint,
        lastSeen: peer.lastSeen ?? new Date().toISOString(),
      });
      void (async () => {
        try {
          await client!.set(peerKey(pid, sid), payload, { EX: TTL_SEC });
          await client!.sAdd(membersKey(pid), sid);
          await client!.expire(membersKey(pid), TTL_SEC);
        } catch {
          detail = 'presence put failed';
        }
      })();
    },
    del(projectId, sessionId) {
      const ids = sanitizeIds(projectId, sessionId);
      if (!ids || !client || !ready) return;
      const { pid, sid } = ids;
      void (async () => {
        try {
          await client!.del(peerKey(pid, sid));
          await client!.sRem(membersKey(pid), sid);
        } catch {
          detail = 'presence del failed';
        }
      })();
    },
    touch(projectId, sessionId, peer) {
      const ids = sanitizeIds(projectId, sessionId);
      if (!ids || !client || !ready) return;
      const { pid, sid } = ids;
      void (async () => {
        try {
          if (peer) {
            const payload = JSON.stringify({
              sessionId: sid,
              displayName: peer.displayName,
              joinedAt: peer.joinedAt,
              colorHint: peer.colorHint,
              lastSeen: peer.lastSeen ?? new Date().toISOString(),
            });
            await client!.set(peerKey(pid, sid), payload, { EX: TTL_SEC });
          } else {
            const existing = await client!.get(peerKey(pid, sid));
            if (existing) {
              const p = parsePeer(existing);
              if (p) {
                p.lastSeen = new Date().toISOString();
                await client!.set(peerKey(pid, sid), JSON.stringify(p), { EX: TTL_SEC });
              } else {
                await client!.expire(peerKey(pid, sid), TTL_SEC);
              }
            }
          }
          await client!.sAdd(membersKey(pid), sid);
          await client!.expire(membersKey(pid), TTL_SEC);
        } catch {
          detail = 'presence touch failed';
        }
      })();
    },
    async list(projectId) {
      const ids = sanitizeIds(projectId);
      if (!ids || !client || !ready) return [];
      const { pid } = ids;
      try {
        const members = await client.sMembers(membersKey(pid));
        const out: PresencePeer[] = [];
        for (const sid of members) {
          if (!sid || /[\0\r\n]/.test(sid)) continue;
          const raw = await client.get(peerKey(pid, sid));
          if (!raw) {
            void client.sRem(membersKey(pid), sid);
            continue;
          }
          const peer = parsePeer(raw);
          if (peer) out.push(peer);
        }
        out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
        return out;
      } catch {
        detail = 'presence list failed';
        return [];
      }
    },
    status() {
      return {
        kind: ready ? 'redis' : 'redis-stub',
        ready: true,
        detail: ready ? `redis TTL=${TTL_SEC}s` : detail,
      };
    },
    async close() {
      closed = true;
      try {
        await client?.quit();
      } catch {
        /* ignore */
      }
      client = null;
      ready = false;
    },
  };

  void (async () => {
    try {
      const mod = (await import('redis' as string)) as {
        createClient: (opts: { url: string }) => RedisClientLike;
      };
      if (closed) return;
      client = mod.createClient({ url });
      client.on?.('error', () => {
        detail = 'redis presence error';
      });
      await client.connect();
      ready = true;
      detail = `redis presence TTL=${TTL_SEC}s`;
    } catch (err) {
      ready = false;
      detail =
        err instanceof Error
          ? `redis presence unavailable (${err.message}); install "redis" + set URL`
          : 'redis presence unavailable';
    }
  })();

  return registry;
}

let registry: PresenceRegistry | null = null;

export function getPresenceRegistry(): PresenceRegistry {
  if (!registry) {
    registry = createPresenceRegistry();
  }
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

/** Test helper. */
export function resetPresenceRegistryForTests(): void {
  shutdownPresenceRegistry();
}

export function setPresenceRegistryForTests(r: PresenceRegistry | null): void {
  registry = r;
}

export { TTL_SEC as PRESENCE_REDIS_TTL_SEC };
