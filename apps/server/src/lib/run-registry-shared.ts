/**
 * Optional shared run summary store (v0.16 Track B / B0).
 *
 * Dual-writes lightweight run summaries so multi-replica GET / cancel can
 * resolve runs that live on another process. Local RunRegistry remains the
 * source of truth for abort controllers and event streams.
 *
 * Env: NEOS_RUN_REGISTRY=auto|memory|redis|off
 *   auto → redis when NEOS_COLLAB_BUS=redis or a Redis URL is set and the
 *          optional `redis` package connects; else in-process memory mirror
 *   off  → no dual-write (today's single-process behaviour)
 *
 * Keys / channel:
 *   neos:run:summary:{id}   SET EX ttl  (JSON SharedRunSummary)
 *   neos:run:commands       pub/sub     (cancel intents)
 *
 * Non-goals: multi-node SSE event fan-out, durable event log, Postgres store.
 */

import { randomBytes } from 'node:crypto';
import { getGlobalRunRegistry, type RuntimeRunRecord } from '@neos-work/agent-runtime';
import { isTerminalRunStatus } from '@neos-work/shared';
import { getCollabBus } from './collab-bus.js';
import { resolveCollabRedisUrl } from './collab-redis-url.js';
import {
  resolveRegistryMode,
  type RegistryKind,
  type RegistryMode,
  type RegistryStatus,
} from './collab-ttl-registry.js';

/** Default summary TTL — match local RunRegistry (1h). */
export const RUN_SUMMARY_TTL_SEC = 60 * 60;

const SUMMARY_KEY_PREFIX = 'neos:run:summary:';
const COMMAND_CHANNEL = 'neos:run:commands';

export type SharedRunSummary = {
  id: string;
  status: string;
  /** Process that owns the live run (abort / events). */
  nodeId: string;
  projectId: string | null;
  collabSessionId: string | null;
  agentId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type RunCancelCommand = {
  type: 'run.cancel';
  runId: string;
  originNodeId: string;
  ts: string;
};

export type SharedRunStoreStatus = RegistryStatus & {
  nodeId: string;
};

export type CancelCommandHandler = (cmd: RunCancelCommand) => void;

export interface SharedRunStore {
  readonly kind: RegistryKind;
  readonly nodeId: string;
  put(summary: SharedRunSummary): Promise<void>;
  get(id: string): Promise<SharedRunSummary | null>;
  /** Best-effort mark canceled in the store (does not abort local run). */
  markCanceled(id: string): Promise<SharedRunSummary | null>;
  publishCancel(runId: string): Promise<void>;
  onCancelCommand(handler: CancelCommandHandler): () => void;
  status(): SharedRunStoreStatus;
  close(): Promise<void>;
}

type RedisClientLike = {
  connect: () => Promise<unknown>;
  duplicate: () => RedisClientLike;
  set: (key: string, value: string, opts?: { EX?: number }) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  publish: (channel: string, message: string) => Promise<unknown>;
  subscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>;
  quit: () => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
};

export function resolveRunRegistryMode(
  env: NodeJS.ProcessEnv = process.env,
): RegistryMode {
  return resolveRegistryMode(env, 'NEOS_RUN_REGISTRY');
}

function sanitizeRunId(id: string): string | null {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return null;
  const t = id.trim();
  if (!t || t.length > 128) return null;
  return t;
}

export function parseSharedRunSummary(raw: string): SharedRunSummary | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.id !== 'string' || /[\0\r\n]/.test(o.id)) return null;
    const id = o.id.trim();
    if (!id || id.length > 128) return null;
    if (typeof o.status !== 'string' || /[\0\r\n]/.test(o.status)) return null;
    const status = o.status.trim().slice(0, 32);
    if (!status) return null;
    if (typeof o.nodeId !== 'string' || /[\0\r\n]/.test(o.nodeId)) return null;
    const nodeId = o.nodeId.trim().slice(0, 64);
    if (!nodeId) return null;
    const strOrNull = (v: unknown, max = 256): string | null => {
      if (v == null) return null;
      if (typeof v !== 'string' || /[\0\r\n]/.test(v)) return null;
      const s = v.trim();
      return s ? s.slice(0, max) : null;
    };
    const iso = (v: unknown): string | null => {
      if (typeof v !== 'string' || /[\0\r\n]/.test(v)) return null;
      const s = v.trim();
      if (!s || s.length > 40) return null;
      return s;
    };
    const createdAt = iso(o.createdAt) ?? new Date().toISOString();
    return {
      id,
      status,
      nodeId,
      projectId: strOrNull(o.projectId, 128),
      collabSessionId: strOrNull(o.collabSessionId, 64),
      agentId: strOrNull(o.agentId, 128),
      error: strOrNull(o.error, 2_048),
      createdAt,
      startedAt: iso(o.startedAt),
      completedAt: iso(o.completedAt),
      updatedAt: iso(o.updatedAt) ?? createdAt,
    };
  } catch {
    return null;
  }
}

export function serializeSharedRunSummary(s: SharedRunSummary): string {
  return JSON.stringify({
    id: s.id,
    status: s.status,
    nodeId: s.nodeId,
    projectId: s.projectId,
    collabSessionId: s.collabSessionId,
    agentId: s.agentId,
    error: s.error,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    updatedAt: s.updatedAt,
  });
}

export function summaryFromRecord(
  record: RuntimeRunRecord,
  nodeId: string,
): SharedRunSummary {
  const now = new Date().toISOString();
  return {
    id: record.id,
    status: record.status,
    nodeId,
    projectId: record.projectId ?? null,
    collabSessionId: record.collabSessionId ?? null,
    agentId: record.agentId ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    updatedAt: now,
  };
}

/** Stable process node id (mirrors collab bus when available). */
let processNodeId: string | null = null;

export function getRunRegistryNodeId(): string {
  if (processNodeId) return processNodeId;
  // Prefer collab bus node id when bus already initialized (same process identity).
  try {
    const id = getCollabBus().nodeId;
    if (typeof id === 'string' && id.trim()) {
      processNodeId = id.trim().slice(0, 64);
      return processNodeId;
    }
  } catch {
    /* bus not ready */
  }
  processNodeId = randomBytes(8).toString('hex');
  return processNodeId;
}

export function setRunRegistryNodeIdForTests(id: string | null): void {
  processNodeId = id;
}

// ── Memory backend (also used as redis-stub / dual-process test map) ────────

type MemoryBackend = {
  map: Map<string, SharedRunSummary>;
  handlers: Set<CancelCommandHandler>;
};

function createMemoryBackend(): MemoryBackend {
  return { map: new Map(), handlers: new Set() };
}

/** Process-wide memory backend so dual-write works within one process. */
let defaultMemoryBackend: MemoryBackend | null = null;

function getDefaultMemoryBackend(): MemoryBackend {
  if (!defaultMemoryBackend) defaultMemoryBackend = createMemoryBackend();
  return defaultMemoryBackend;
}

export function createMemorySharedRunStore(opts?: {
  nodeId?: string;
  backend?: MemoryBackend;
  kind?: 'memory' | 'redis-stub' | 'off';
  detail?: string;
}): SharedRunStore {
  const nodeId = opts?.nodeId ?? getRunRegistryNodeId();
  const backend = opts?.backend ?? getDefaultMemoryBackend();
  const kind = opts?.kind ?? 'memory';
  const detail =
    opts?.detail
    ?? (kind === 'off'
      ? 'NEOS_RUN_REGISTRY=off'
      : kind === 'redis-stub'
        ? 'run registry redis-stub (local memory mirror only)'
        : 'in-process run summary mirror');

  const store: SharedRunStore = {
    kind,
    nodeId,
    async put(summary) {
      if (kind === 'off') return;
      const id = sanitizeRunId(summary.id);
      if (!id) return;
      backend.map.set(id, { ...summary, id });
    },
    async get(id) {
      if (kind === 'off') return null;
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      return backend.map.get(sid) ?? null;
    },
    async markCanceled(id) {
      if (kind === 'off') return null;
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      const existing = backend.map.get(sid);
      if (!existing) return null;
      if (isTerminalRunStatus(existing.status)) return existing;
      const now = new Date().toISOString();
      const next: SharedRunSummary = {
        ...existing,
        status: 'canceled',
        completedAt: existing.completedAt ?? now,
        updatedAt: now,
      };
      backend.map.set(sid, next);
      return next;
    },
    async publishCancel(runId) {
      if (kind === 'off') return;
      const sid = sanitizeRunId(runId);
      if (!sid) return;
      const cmd: RunCancelCommand = {
        type: 'run.cancel',
        runId: sid,
        originNodeId: nodeId,
        ts: new Date().toISOString(),
      };
      for (const h of [...backend.handlers]) {
        try {
          h(cmd);
        } catch {
          /* ignore */
        }
      }
    },
    onCancelCommand(handler) {
      if (kind === 'off') return () => {};
      backend.handlers.add(handler);
      return () => {
        backend.handlers.delete(handler);
      };
    },
    status() {
      return {
        kind,
        ready: true,
        detail,
        nodeId,
      };
    },
    async close() {
      /* shared backend retained for process lifetime unless tests clear it */
    },
  };
  return store;
}

// ── Redis backend ───────────────────────────────────────────────────────────

function createRedisSharedRunStore(
  env: NodeJS.ProcessEnv,
  nodeId: string,
): SharedRunStore {
  const url = resolveCollabRedisUrl(env);
  if (!url) {
    return createMemorySharedRunStore({
      nodeId,
      kind: 'redis-stub',
      detail:
        'NEOS_RUN_REGISTRY wants redis but NEOS_COLLAB_REDIS_URL/REDIS_URL unset — local stub',
    });
  }

  let pub: RedisClientLike | null = null;
  let sub: RedisClientLike | null = null;
  let connected = false;
  let connecting = true;
  let detail = 'connecting…';
  let closed = false;
  let kind: RegistryKind = 'redis-stub';
  const handlers = new Set<CancelCommandHandler>();
  // Local memory mirror while connecting / if redis drops
  const mirror = createMemoryBackend();

  const deliverCancel = (cmd: RunCancelCommand) => {
    for (const h of [...handlers]) {
      try {
        h(cmd);
      } catch {
        /* ignore */
      }
    }
  };

  const store: SharedRunStore = {
    get kind() {
      return kind;
    },
    nodeId,
    async put(summary) {
      const id = sanitizeRunId(summary.id);
      if (!id) return;
      const payload = { ...summary, id };
      mirror.map.set(id, payload);
      if (!pub || !connected) return;
      try {
        await pub.set(
          `${SUMMARY_KEY_PREFIX}${id}`,
          serializeSharedRunSummary(payload),
          { EX: RUN_SUMMARY_TTL_SEC },
        );
      } catch {
        detail = 'run summary put failed';
      }
    },
    async get(id) {
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      if (pub && connected) {
        try {
          const raw = await pub.get(`${SUMMARY_KEY_PREFIX}${sid}`);
          if (raw) {
            const parsed = parseSharedRunSummary(raw);
            if (parsed) {
              mirror.map.set(sid, parsed);
              return parsed;
            }
          }
        } catch {
          detail = 'run summary get failed';
        }
      }
      return mirror.map.get(sid) ?? null;
    },
    async markCanceled(id) {
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      const existing = await store.get(sid);
      if (!existing) return null;
      if (isTerminalRunStatus(existing.status)) return existing;
      const now = new Date().toISOString();
      const next: SharedRunSummary = {
        ...existing,
        status: 'canceled',
        completedAt: existing.completedAt ?? now,
        updatedAt: now,
      };
      await store.put(next);
      return next;
    },
    async publishCancel(runId) {
      const sid = sanitizeRunId(runId);
      if (!sid) return;
      const cmd: RunCancelCommand = {
        type: 'run.cancel',
        runId: sid,
        originNodeId: nodeId,
        ts: new Date().toISOString(),
      };
      // Always deliver locally (owner may be this node)
      deliverCancel(cmd);
      if (pub && connected) {
        try {
          await pub.publish(COMMAND_CHANNEL, JSON.stringify(cmd));
        } catch {
          detail = 'run cancel publish failed';
        }
      }
    },
    onCancelCommand(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    status() {
      return {
        kind,
        ready: !connecting,
        detail: connected
          ? `redis channel=${COMMAND_CHANNEL} TTL=${RUN_SUMMARY_TTL_SEC}s`
          : detail,
        nodeId,
      };
    },
    async close() {
      closed = true;
      connecting = false;
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
      pub = mod.createClient({ url });
      sub = pub.duplicate();
      pub.on?.('error', () => {
        detail = 'redis run registry pub error';
      });
      sub.on?.('error', () => {
        detail = 'redis run registry sub error';
      });
      await pub.connect();
      await sub.connect();
      await sub.subscribe(COMMAND_CHANNEL, (message: string) => {
        if (typeof message !== 'string' || !message || /[\0]/.test(message)) return;
        try {
          const cmd = JSON.parse(message) as RunCancelCommand;
          if (!cmd || cmd.type !== 'run.cancel') return;
          if (typeof cmd.runId !== 'string' || !sanitizeRunId(cmd.runId)) return;
          if (cmd.originNodeId === nodeId) return; // already delivered locally
          deliverCancel({
            type: 'run.cancel',
            runId: cmd.runId.trim(),
            originNodeId:
              typeof cmd.originNodeId === 'string' ? cmd.originNodeId.slice(0, 64) : '',
            ts: typeof cmd.ts === 'string' ? cmd.ts : new Date().toISOString(),
          });
        } catch {
          /* ignore bad messages */
        }
      });
      if (closed) {
        await store.close();
        return;
      }
      connected = true;
      connecting = false;
      kind = 'redis';
      detail = `redis channel=${COMMAND_CHANNEL} TTL=${RUN_SUMMARY_TTL_SEC}s`;
    } catch (err) {
      connecting = false;
      connected = false;
      kind = 'redis-stub';
      detail =
        err instanceof Error
          ? `redis run registry unavailable (${err.message}); install "redis" + set URL`
          : 'redis run registry unavailable';
    }
  })();

  return store;
}

// ── Factory + singleton ─────────────────────────────────────────────────────

export function createSharedRunStore(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { nodeId?: string; memoryBackend?: MemoryBackend },
): SharedRunStore {
  const mode = resolveRunRegistryMode(env);
  const nodeId = opts?.nodeId ?? getRunRegistryNodeId();

  if (mode === 'off') {
    return createMemorySharedRunStore({
      nodeId,
      kind: 'off',
      detail: 'NEOS_RUN_REGISTRY=off',
      backend: opts?.memoryBackend,
    });
  }

  if (mode === 'memory') {
    return createMemorySharedRunStore({
      nodeId,
      kind: 'memory',
      backend: opts?.memoryBackend ?? getDefaultMemoryBackend(),
    });
  }

  const busWantsRedis = (env.NEOS_COLLAB_BUS ?? 'memory').trim().toLowerCase() === 'redis';
  const urlPresent = !!resolveCollabRedisUrl(env);
  const wantsRedis = mode === 'redis' || (mode === 'auto' && (busWantsRedis || urlPresent));

  if (!wantsRedis) {
    return createMemorySharedRunStore({
      nodeId,
      kind: 'memory',
      detail: 'in-process run summary mirror (auto: no redis bus/URL)',
      backend: opts?.memoryBackend ?? getDefaultMemoryBackend(),
    });
  }

  if (mode === 'redis' || mode === 'auto') {
    return createRedisSharedRunStore(env, nodeId);
  }

  return createMemorySharedRunStore({
    nodeId,
    kind: 'memory',
    backend: opts?.memoryBackend ?? getDefaultMemoryBackend(),
  });
}

let store: SharedRunStore | null = null;
let cancelUnsub: (() => void) | null = null;

/**
 * Apply a cancel command against the local RunRegistry when this node owns
 * the live run (or the run is present locally).
 */
export function applyLocalCancelFromCommand(cmd: RunCancelCommand): boolean {
  if (cmd.type !== 'run.cancel') return false;
  const reg = getGlobalRunRegistry();
  const run = reg.get(cmd.runId);
  if (!run) return false;
  if (isTerminalRunStatus(run.status)) return false;
  return reg.cancel(cmd.runId);
}

function wireCancelListener(s: SharedRunStore): void {
  if (cancelUnsub) {
    cancelUnsub();
    cancelUnsub = null;
  }
  cancelUnsub = s.onCancelCommand((cmd) => {
    const canceled = applyLocalCancelFromCommand(cmd);
    if (canceled) {
      // Dual-write terminal status after local abort
      void syncRunSummary(cmd.runId);
    }
  });
}

export function getSharedRunStore(): SharedRunStore {
  if (!store) {
    store = createSharedRunStore();
    wireCancelListener(store);
  }
  return store;
}

export function initSharedRunStore(
  env: NodeJS.ProcessEnv = process.env,
): SharedRunStore {
  if (store) {
    void store.close();
    store = null;
  }
  if (cancelUnsub) {
    cancelUnsub();
    cancelUnsub = null;
  }
  store = createSharedRunStore(env);
  wireCancelListener(store);
  return store;
}

export function shutdownSharedRunStore(): void {
  if (cancelUnsub) {
    cancelUnsub();
    cancelUnsub = null;
  }
  if (store) {
    void store.close();
    store = null;
  }
}

export function resetSharedRunStoreForTests(): void {
  shutdownSharedRunStore();
  defaultMemoryBackend = null;
  processNodeId = null;
}

export function setSharedRunStoreForTests(s: SharedRunStore | null): void {
  if (cancelUnsub) {
    cancelUnsub();
    cancelUnsub = null;
  }
  store = s;
  if (s) wireCancelListener(s);
}

/** Dual-write local run → shared summary (best-effort, fire-and-forget safe). */
export async function syncRunSummary(runId: string): Promise<void> {
  const s = getSharedRunStore();
  if (s.kind === 'off') return;
  const run = getGlobalRunRegistry().get(runId);
  if (!run) return;
  await s.put(summaryFromRecord(run, s.nodeId));
}

/** Dual-write from an already-fetched record. */
export async function dualWriteRunRecord(record: RuntimeRunRecord): Promise<void> {
  const s = getSharedRunStore();
  if (s.kind === 'off') return;
  await s.put(summaryFromRecord(record, s.nodeId));
}

/** Export memory backend factory for multi-node simulation in tests. */
export function createSharedMemoryBackendForTests(): MemoryBackend {
  return createMemoryBackend();
}
