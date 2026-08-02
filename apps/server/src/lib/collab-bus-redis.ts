/**
 * Redis collab bus adapter (v0.7 M1).
 *
 * When NEOS_COLLAB_BUS=redis:
 * - If `redis` package is installed and NEOS_COLLAB_REDIS_URL / REDIS_URL is set,
 *   attempts dynamic import and pub/sub on channel `neos:collab:events`.
 * - Otherwise runs as **redis-stub**: local publish only to in-process subscribers
 *   (same process), with status.detail explaining how to enable full Redis.
 *
 * Does not add a hard dependency on `redis` to the monorepo.
 */

import { randomBytes } from 'node:crypto';
import type { CollabEvent } from './collab-types.js';
import type { CollabBus, CollabBusEnvelope, CollabBusHandler, CollabBusStatus } from './collab-bus.js';
import { createMemoryCollabBus } from './collab-bus-memory.js';

const CHANNEL = 'neos:collab:events';

function redisUrl(env: NodeJS.ProcessEnv): string | null {
  for (const k of ['NEOS_COLLAB_REDIS_URL', 'REDIS_URL']) {
    const v = env[k];
    if (typeof v === 'string' && !/[\0\r\n]/.test(v) && v.trim()) {
      const t = v.trim();
      if (t.length <= 2_048 && (t.startsWith('redis://') || t.startsWith('rediss://'))) {
        return t;
      }
    }
  }
  return null;
}

/** Stub that mirrors memory bus but reports kind redis-stub. */
function createRedisStub(detail: string): CollabBus {
  const inner = createMemoryCollabBus();
  return {
    kind: 'redis-stub',
    nodeId: inner.nodeId,
    publish: (p, e) => inner.publish(p, e),
    subscribe: (h) => inner.subscribe(h),
    status: () => ({
      kind: 'redis-stub',
      nodeId: inner.nodeId,
      ready: true,
      detail,
    }),
    close: () => inner.close(),
  };
}

type RedisClientLike = {
  connect: () => Promise<unknown>;
  duplicate: () => RedisClientLike;
  subscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<unknown>;
  quit: () => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
};

/**
 * Try real Redis via optional `redis` package; fall back to stub.
 */
export function createRedisCollabBus(env: NodeJS.ProcessEnv = process.env): CollabBus {
  const url = redisUrl(env);
  if (!url) {
    return createRedisStub(
      'NEOS_COLLAB_BUS=redis but NEOS_COLLAB_REDIS_URL/REDIS_URL unset — using local stub',
    );
  }

  // Lazy async connect; start as stub-like until ready
  const nodeId = randomBytes(8).toString('hex');
  const handlers = new Set<CollabBusHandler>();
  let pub: RedisClientLike | null = null;
  let sub: RedisClientLike | null = null;
  let ready = false;
  let detail = 'connecting…';
  let closed = false;

  const bus: CollabBus = {
    kind: 'redis',
    nodeId,
    publish(projectId: string, event: CollabEvent) {
      const envelope: CollabBusEnvelope = {
        projectId,
        event,
        originNodeId: nodeId,
        ts: new Date().toISOString(),
      };
      // Always notify local handlers immediately
      for (const h of [...handlers]) {
        try {
          h(envelope);
        } catch {
          /* ignore */
        }
      }
      if (pub && ready) {
        void pub.publish(CHANNEL, JSON.stringify(envelope)).catch(() => {
          detail = 'publish failed';
        });
      }
    },
    subscribe(handler: CollabBusHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    status(): CollabBusStatus {
      return {
        kind: ready ? 'redis' : 'redis-stub',
        nodeId,
        ready: true,
        detail: ready ? `redis channel=${CHANNEL}` : detail,
      };
    },
    async close() {
      closed = true;
      handlers.clear();
      try {
        await sub?.quit();
      } catch {
        /* ignore */
      }
      try {
        await pub?.quit();
      } catch {
        /* ignore */
      }
      pub = null;
      sub = null;
      ready = false;
    },
  };

  void (async () => {
    try {
      // Optional dependency — may not be installed
      const mod = (await import('redis' as string)) as {
        createClient: (opts: { url: string }) => RedisClientLike;
      };
      if (closed) return;
      pub = mod.createClient({ url });
      sub = pub.duplicate();
      pub.on?.('error', () => {
        detail = 'redis pub error';
      });
      sub.on?.('error', () => {
        detail = 'redis sub error';
      });
      await pub.connect();
      await sub.connect();
      await sub.subscribe(CHANNEL, (message: string) => {
        if (typeof message !== 'string' || !message || /[\0]/.test(message)) return;
        try {
          const envelope = JSON.parse(message) as CollabBusEnvelope;
          if (!envelope || typeof envelope !== 'object') return;
          if (envelope.originNodeId === nodeId) return;
          if (typeof envelope.projectId !== 'string' || !envelope.event) return;
          for (const h of [...handlers]) {
            try {
              h(envelope);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore bad payload */
        }
      });
      ready = true;
      detail = `redis connected channel=${CHANNEL}`;
    } catch (err) {
      ready = false;
      detail =
        err instanceof Error
          ? `redis unavailable (${err.message}); local fan-out only — install package "redis" and set NEOS_COLLAB_REDIS_URL`
          : 'redis unavailable; local fan-out only';
      // Keep bus usable as local fan-out via handlers (already in publish)
    }
  })();

  return bus;
}
