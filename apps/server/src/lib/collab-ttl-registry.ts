/**
 * Shared Redis TTL JSON registry for multi-replica collab (presence + locks).
 *
 * Keys:
 *   itemKey(projectId, memberId)  SET EX ttl
 *   setKey(projectId)             SET of memberIds
 *
 * No hard dependency on `redis` — dynamic import; stub when unavailable.
 */

import { resolveCollabRedisUrl } from './collab-redis-url.js';

export type RegistryMode = 'off' | 'memory' | 'redis' | 'auto';
export type RegistryKind = 'off' | 'memory' | 'redis' | 'redis-stub';

export type RegistryStatus = {
  kind: RegistryKind;
  /** False only while a Redis connect attempt is in flight. */
  ready: boolean;
  detail?: string;
};

export interface TtlJsonRegistry<T> {
  readonly kind: RegistryKind;
  put(projectId: string, item: T): Promise<void>;
  del(projectId: string, memberId: string): Promise<void>;
  /** Refresh TTL; optionally rewrite payload when item is provided. */
  touch(projectId: string, memberId: string, item?: T): Promise<void>;
  list(projectId: string): Promise<T[]>;
  status(): RegistryStatus;
  close(): Promise<void>;
}

export type TtlJsonRegistryConfig<T> = {
  /** Short label for logs/status (e.g. "presence", "locks"). */
  label: string;
  /** Env var for mode (e.g. NEOS_COLLAB_PRESENCE). */
  modeEnvKey: string;
  ttlSec: number;
  itemKey: (projectId: string, memberId: string) => string;
  setKey: (projectId: string) => string;
  memberId: (item: T) => string;
  serialize: (item: T) => string;
  parse: (raw: string) => T | null;
  sortList?: (a: T, b: T) => number;
  memoryDetail: string;
  /** Max length for member id (sessionId / path). */
  memberIdMaxLen?: number;
};

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

export function resolveRegistryMode(
  env: NodeJS.ProcessEnv,
  modeEnvKey: string,
): RegistryMode {
  const raw = (env[modeEnvKey] ?? 'auto').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'memory') return 'memory';
  if (raw === 'redis') return 'redis';
  return 'auto';
}

function sanitizeProjectId(projectId: string): string | null {
  if (typeof projectId !== 'string' || /[\0\r\n]/.test(projectId)) return null;
  const pid = projectId.trim();
  if (!pid || pid.length > 128) return null;
  return pid;
}

function sanitizeMemberId(memberId: string, maxLen: number): string | null {
  if (typeof memberId !== 'string' || /[\0\r\n]/.test(memberId)) return null;
  const m = memberId.trim();
  if (!m || m.length > maxLen) return null;
  return m;
}

function createStaticRegistry<T>(
  kind: 'off' | 'memory' | 'redis-stub',
  detail: string,
): TtlJsonRegistry<T> {
  return {
    kind,
    async put() {},
    async del() {},
    async touch() {},
    async list() {
      return [];
    },
    status: () => ({ kind, ready: true, detail }),
    async close() {},
  };
}

export function createTtlJsonRegistry<T>(
  config: TtlJsonRegistryConfig<T>,
  env: NodeJS.ProcessEnv = process.env,
): TtlJsonRegistry<T> {
  const memberMax = config.memberIdMaxLen ?? 512;
  const mode = resolveRegistryMode(env, config.modeEnvKey);

  if (mode === 'off') {
    return createStaticRegistry('off', `${config.modeEnvKey}=off`);
  }
  if (mode === 'memory') {
    return createStaticRegistry('memory', config.memoryDetail);
  }

  const busWantsRedis = (env.NEOS_COLLAB_BUS ?? 'memory').trim().toLowerCase() === 'redis';
  if (mode === 'auto' && !busWantsRedis) {
    return createStaticRegistry('memory', config.memoryDetail);
  }

  const url = resolveCollabRedisUrl(env);
  if (!url) {
    return createStaticRegistry(
      'redis-stub',
      `${config.label} registry wants redis but NEOS_COLLAB_REDIS_URL/REDIS_URL unset`,
    );
  }

  let client: RedisClientLike | null = null;
  let connected = false;
  let connecting = true;
  let detail = 'connecting…';
  let closed = false;
  let kind: RegistryKind = 'redis-stub';
  const ttl = config.ttlSec;

  const registry: TtlJsonRegistry<T> = {
    get kind() {
      return kind;
    },
    async put(projectId, item) {
      const pid = sanitizeProjectId(projectId);
      const mid = sanitizeMemberId(config.memberId(item), memberMax);
      if (!pid || !mid || !client || !connected) return;
      try {
        await client.set(config.itemKey(pid, mid), config.serialize(item), { EX: ttl });
        await client.sAdd(config.setKey(pid), mid);
        await client.expire(config.setKey(pid), ttl);
      } catch {
        detail = `${config.label} put failed`;
      }
    },
    async del(projectId, memberId) {
      const pid = sanitizeProjectId(projectId);
      const mid = sanitizeMemberId(memberId, memberMax);
      if (!pid || !mid || !client || !connected) return;
      try {
        await client.del(config.itemKey(pid, mid));
        await client.sRem(config.setKey(pid), mid);
      } catch {
        detail = `${config.label} del failed`;
      }
    },
    async touch(projectId, memberId, item) {
      const pid = sanitizeProjectId(projectId);
      const mid = sanitizeMemberId(memberId, memberMax);
      if (!pid || !mid || !client || !connected) return;
      try {
        if (item) {
          await client.set(config.itemKey(pid, mid), config.serialize(item), { EX: ttl });
        } else {
          const existing = await client.get(config.itemKey(pid, mid));
          if (existing) {
            const parsed = config.parse(existing);
            if (parsed) {
              await client.set(config.itemKey(pid, mid), config.serialize(parsed), { EX: ttl });
            } else {
              await client.expire(config.itemKey(pid, mid), ttl);
            }
          }
        }
        await client.sAdd(config.setKey(pid), mid);
        await client.expire(config.setKey(pid), ttl);
      } catch {
        detail = `${config.label} touch failed`;
      }
    },
    async list(projectId) {
      const pid = sanitizeProjectId(projectId);
      if (!pid || !client || !connected) return [];
      try {
        const members = await client.sMembers(config.setKey(pid));
        const out: T[] = [];
        for (const mid of members) {
          if (!mid || /[\0\r\n]/.test(mid)) continue;
          const raw = await client.get(config.itemKey(pid, mid));
          if (!raw) {
            void client.sRem(config.setKey(pid), mid);
            continue;
          }
          const item = config.parse(raw);
          if (item) out.push(item);
        }
        if (config.sortList) out.sort(config.sortList);
        return out;
      } catch {
        detail = `${config.label} list failed`;
        return [];
      }
    },
    status() {
      return {
        kind,
        ready: !connecting,
        detail: connected ? `redis TTL=${ttl}s` : detail,
      };
    },
    async close() {
      closed = true;
      connecting = false;
      try {
        await client?.quit();
      } catch {
        /* ignore */
      }
      client = null;
      connected = false;
      kind = 'redis-stub';
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
        detail = `redis ${config.label} error`;
      });
      await client.connect();
      if (closed) {
        try {
          await client.quit();
        } catch {
          /* ignore */
        }
        client = null;
        return;
      }
      connected = true;
      connecting = false;
      kind = 'redis';
      detail = `redis ${config.label} TTL=${ttl}s`;
    } catch (err) {
      connecting = false;
      connected = false;
      kind = 'redis-stub';
      detail =
        err instanceof Error
          ? `redis ${config.label} unavailable (${err.message}); install "redis" + set URL`
          : `redis ${config.label} unavailable`;
    }
  })();

  return registry;
}

/** Match PRESENCE_REMOTE_IDLE_MS (270s). */
export const COLLAB_REGISTRY_TTL_SEC = 270;
