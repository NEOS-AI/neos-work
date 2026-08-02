/**
 * Pluggable collab transport (v0.7 M1).
 * Fans presence/lock events across processes; local room state stays in project-collab.
 *
 * NEOS_COLLAB_BUS=memory (default) | redis
 * NEOS_COLLAB_REDIS_URL=redis://…  (when bus=redis)
 */

import type { CollabEvent } from './collab-types.js';
import { createMemoryCollabBus } from './collab-bus-memory.js';
import { createRedisCollabBus } from './collab-bus-redis.js';

export type CollabBusKind = 'memory' | 'redis' | 'redis-stub';

export type CollabBusEnvelope = {
  projectId: string;
  event: CollabEvent;
  /** Node that published; receivers ignore their own to prevent loops. */
  originNodeId: string;
  ts: string;
};

export type CollabBusHandler = (envelope: CollabBusEnvelope) => void;

export interface CollabBus {
  readonly kind: CollabBusKind;
  /** Unique id for this process. */
  readonly nodeId: string;
  publish(projectId: string, event: CollabEvent): void | Promise<void>;
  /** Subscribe to remote (and optionally local) envelopes. Returns unsubscribe. */
  subscribe(handler: CollabBusHandler): () => void;
  status(): CollabBusStatus;
  close(): void | Promise<void>;
}

export type CollabBusStatus = {
  kind: CollabBusKind;
  nodeId: string;
  ready: boolean;
  detail?: string;
};

let bus: CollabBus | null = null;
let busUnsub: (() => void) | null = null;

/** Events safe to fan out across nodes (no per-session secrets / self blobs). */
export function isCollabBusFanoutEvent(event: CollabEvent): boolean {
  return (
    event.type === 'presence.join'
    || event.type === 'presence.leave'
    || event.type === 'lock.acquired'
    || event.type === 'lock.released'
  );
}

export function resolveCollabBusKind(
  env: NodeJS.ProcessEnv = process.env,
): 'memory' | 'redis' {
  const raw = (env.NEOS_COLLAB_BUS ?? 'memory').trim().toLowerCase();
  if (raw === 'redis') return 'redis';
  return 'memory';
}

/**
 * Create bus for env. Redis mode uses real client when `redis` package resolves
 * and URL is set; otherwise a documented stub that still works single-node.
 */
export function createCollabBus(env: NodeJS.ProcessEnv = process.env): CollabBus {
  const kind = resolveCollabBusKind(env);
  if (kind === 'redis') {
    return createRedisCollabBus(env);
  }
  return createMemoryCollabBus();
}

/** Process-wide singleton; call initCollabBus once at server start. */
export function getCollabBus(): CollabBus {
  if (!bus) {
    bus = createCollabBus();
  }
  return bus;
}

/**
 * Wire bus → local collab deliver. `onRemote` applies envelope without re-publish.
 */
export function initCollabBus(
  onRemote: (projectId: string, event: CollabEvent) => void,
  env: NodeJS.ProcessEnv = process.env,
): CollabBus {
  if (busUnsub) {
    busUnsub();
    busUnsub = null;
  }
  if (bus) {
    void bus.close();
    bus = null;
  }
  bus = createCollabBus(env);
  const nodeId = bus.nodeId;
  busUnsub = bus.subscribe((envelope) => {
    if (envelope.originNodeId === nodeId) return;
    if (!envelope.projectId || !envelope.event) return;
    try {
      onRemote(envelope.projectId, envelope.event);
    } catch {
      // never break bus
    }
  });
  return bus;
}

export function shutdownCollabBus(): void {
  if (busUnsub) {
    busUnsub();
    busUnsub = null;
  }
  if (bus) {
    void bus.close();
    bus = null;
  }
}

/** Test helper — reset singleton. */
export function resetCollabBusForTests(): void {
  shutdownCollabBus();
}
