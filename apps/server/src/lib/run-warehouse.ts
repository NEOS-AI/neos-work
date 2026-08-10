/**
 * Optional Postgres warehouse for long-lived run summary + events (v0.23 Track P).
 *
 * Complements Redis buffer + local JSONL — not a replacement for SQLite app DB.
 * Default is **off** so single-process / CI needs no Postgres.
 *
 * Env:
 *   NEOS_RUN_WAREHOUSE=off|postgres   (default off)
 *   NEOS_RUN_WAREHOUSE_URL or DATABASE_URL — postgres connection string
 *   NEOS_RUN_WAREHOUSE_SCHEMA         (default public; e.g. neos)
 *
 * When enabled:
 *   dual-write summary → UPSERT neos_run_summary
 *   dual-write event   → INSERT neos_run_event (append-only, id-deduped)
 *   GET run / events   → warehouse fallback after local + shared + JSONL miss
 */

import type { RuntimeRunEvent } from '@neos-work/agent-runtime';

/** Same shape as SharedRunSummary / DurableRunSummary for route reuse. */
export type WarehouseRunSummary = {
  id: string;
  status: string;
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

export type RunWarehouseMode = 'off' | 'postgres';

export type RunWarehouseKind = 'off' | 'memory' | 'postgres' | 'postgres-stub';

export type RunWarehouseStatus = {
  kind: RunWarehouseKind;
  ready: boolean;
  detail?: string;
  schema?: string;
};

export interface RunWarehouse {
  putSummary(summary: WarehouseRunSummary): Promise<void>;
  getSummary(id: string): Promise<WarehouseRunSummary | null>;
  appendEvent(runId: string, event: RuntimeRunEvent): Promise<void>;
  listEventsAfter(runId: string, afterEventId?: string): Promise<RuntimeRunEvent[]>;
  status(): RunWarehouseStatus;
  close(): Promise<void>;
}

const RUN_ID_MAX = 128;
const SCHEMA_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Idempotent DDL applied on connect (schema-qualified). */
export function warehouseMigrationSql(schema: string): string {
  const s = quoteIdent(schema);
  return `
CREATE SCHEMA IF NOT EXISTS ${s};
CREATE TABLE IF NOT EXISTS ${s}.neos_run_summary (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  node_id TEXT NOT NULL,
  project_id TEXT,
  collab_session_id TEXT,
  agent_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB
);
CREATE TABLE IF NOT EXISTS ${s}.neos_run_event (
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, event_id)
);
CREATE INDEX IF NOT EXISTS neos_run_event_run_ts
  ON ${s}.neos_run_event (run_id, ts);
`.trim();
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function sanitizeRunId(id: string): string | null {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return null;
  const t = id.trim();
  if (!t || t.length > RUN_ID_MAX) return null;
  return t;
}

function sanitizeSummary(raw: WarehouseRunSummary): WarehouseRunSummary | null {
  const id = sanitizeRunId(raw.id);
  if (!id) return null;
  if (typeof raw.status !== 'string' || /[\0\r\n]/.test(raw.status)) return null;
  const status = raw.status.trim().slice(0, 32);
  if (!status) return null;
  if (typeof raw.nodeId !== 'string' || /[\0\r\n]/.test(raw.nodeId)) return null;
  const nodeId = raw.nodeId.trim().slice(0, 64);
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
  const createdAt = iso(raw.createdAt) ?? new Date().toISOString();
  return {
    id,
    status,
    nodeId,
    projectId: strOrNull(raw.projectId, 128),
    collabSessionId: strOrNull(raw.collabSessionId, 64),
    agentId: strOrNull(raw.agentId, 128),
    error: strOrNull(raw.error, 2_048),
    createdAt,
    startedAt: iso(raw.startedAt),
    completedAt: iso(raw.completedAt),
    updatedAt: iso(raw.updatedAt) ?? createdAt,
  };
}

function sanitizeEvent(raw: RuntimeRunEvent): RuntimeRunEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || /[\0\r\n]/.test(raw.id)) return null;
  const id = raw.id.trim();
  if (!id || id.length > 128) return null;
  if (typeof raw.type !== 'string' || /[\0\r\n]/.test(raw.type)) return null;
  const type = raw.type.trim().slice(0, 64);
  if (!type) return null;
  let ts: string;
  if (typeof raw.ts === 'string' && !/[\0\r\n]/.test(raw.ts)) {
    const t = raw.ts.trim();
    ts = t && t.length <= 40 ? t : new Date().toISOString();
  } else {
    ts = new Date().toISOString();
  }
  const event: RuntimeRunEvent = { id, type, ts };
  if ('data' in raw && raw.data !== undefined) {
    event.data = raw.data;
  }
  return event;
}

function eventsAfterInList(
  events: RuntimeRunEvent[],
  afterEventId?: string,
): RuntimeRunEvent[] {
  if (!afterEventId) return [...events];
  const idx = events.findIndex((e) => e.id === afterEventId);
  if (idx < 0) return [...events];
  return events.slice(idx + 1);
}

// ── Env resolvers ───────────────────────────────────────────────────────────

export function resolveRunWarehouseMode(
  env: NodeJS.ProcessEnv = process.env,
): RunWarehouseMode {
  const raw = (env.NEOS_RUN_WAREHOUSE ?? 'off').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false' || raw === '') return 'off';
  if (
    raw === 'postgres'
    || raw === 'pg'
    || raw === 'on'
    || raw === '1'
    || raw === 'true'
  ) {
    return 'postgres';
  }
  return 'off';
}

export function resolveRunWarehouseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const key of ['NEOS_RUN_WAREHOUSE_URL', 'DATABASE_URL'] as const) {
    const raw = env[key];
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) continue;
    const t = raw.trim();
    if (t) return t;
  }
  return null;
}

export function resolveRunWarehouseSchema(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.NEOS_RUN_WAREHOUSE_SCHEMA;
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'public';
  const t = raw.trim();
  if (!t || t.length > 63 || !SCHEMA_RE.test(t)) return 'public';
  return t;
}

// ── Off warehouse ───────────────────────────────────────────────────────────

export function createOffWarehouse(detail = 'NEOS_RUN_WAREHOUSE=off'): RunWarehouse {
  return {
    async putSummary() {},
    async getSummary() {
      return null;
    },
    async appendEvent() {},
    async listEventsAfter() {
      return [];
    },
    status() {
      return { kind: 'off', ready: true, detail };
    },
    async close() {},
  };
}

// ── Memory warehouse (tests / dual-process simulation) ──────────────────────

type MemoryBackend = {
  summaries: Map<string, WarehouseRunSummary>;
  events: Map<string, RuntimeRunEvent[]>;
};

export function createMemoryWarehouse(opts?: {
  backend?: MemoryBackend;
  detail?: string;
}): RunWarehouse {
  const backend = opts?.backend ?? {
    summaries: new Map(),
    events: new Map(),
  };
  const detail = opts?.detail ?? 'in-process run warehouse';

  return {
    async putSummary(summary) {
      const s = sanitizeSummary(summary);
      if (!s) return;
      backend.summaries.set(s.id, s);
    },
    async getSummary(id) {
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      return backend.summaries.get(sid) ?? null;
    },
    async appendEvent(runId, event) {
      const sid = sanitizeRunId(runId);
      if (!sid) return;
      const ev = sanitizeEvent(event);
      if (!ev) return;
      let buf = backend.events.get(sid);
      if (!buf) {
        buf = [] as RuntimeRunEvent[];
        backend.events.set(sid, buf);
      }
      if (buf.some((e: RuntimeRunEvent) => e.id === ev.id)) return;
      buf.push(ev);
    },
    async listEventsAfter(runId, afterEventId) {
      const sid = sanitizeRunId(runId);
      if (!sid) return [];
      const buf = backend.events.get(sid) ?? [];
      return eventsAfterInList(buf, afterEventId);
    },
    status() {
      return { kind: 'memory', ready: true, detail };
    },
    async close() {},
  };
}

// ── Postgres stub (no URL / no package / connect fail) ──────────────────────

function createPostgresStubWarehouse(detail: string, schema: string): RunWarehouse {
  return {
    async putSummary() {},
    async getSummary() {
      return null;
    },
    async appendEvent() {},
    async listEventsAfter() {
      return [];
    },
    status() {
      return { kind: 'postgres-stub', ready: false, detail, schema };
    },
    async close() {},
  };
}

// ── Postgres warehouse ──────────────────────────────────────────────────────

type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type PgModule = {
  Pool: new (opts: { connectionString: string }) => PgPoolLike;
};

/**
 * Create a Postgres-backed warehouse. Connects + migrates in background.
 * If `pg` is unavailable or connect fails, status becomes `postgres-stub`.
 */
export function createPostgresWarehouse(
  url: string,
  opts?: { schema?: string },
): RunWarehouse {
  const schema = opts?.schema && SCHEMA_RE.test(opts.schema) ? opts.schema : 'public';
  const sIdent = quoteIdent(schema);
  const summaryTable = `${sIdent}.neos_run_summary`;
  const eventTable = `${sIdent}.neos_run_event`;

  let pool: PgPoolLike | null = null;
  let kind: RunWarehouseKind = 'postgres-stub';
  let ready = false;
  let detail = 'connecting…';
  let closed = false;
  let readyPromise: Promise<void> | null = null;

  const ensureReady = async (): Promise<boolean> => {
    if (closed) return false;
    if (ready && pool) return true;
    if (readyPromise) {
      await readyPromise;
      return !!(ready && pool);
    }
    return false;
  };

  const store: RunWarehouse = {
    async putSummary(summary) {
      const s = sanitizeSummary(summary);
      if (!s) return;
      if (!(await ensureReady()) || !pool) return;
      try {
        const payload = JSON.stringify(s);
        await pool.query(
          `INSERT INTO ${summaryTable} (
            id, status, node_id, project_id, collab_session_id, agent_id, error,
            created_at, started_at, completed_at, updated_at, payload
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            node_id = EXCLUDED.node_id,
            project_id = EXCLUDED.project_id,
            collab_session_id = EXCLUDED.collab_session_id,
            agent_id = EXCLUDED.agent_id,
            error = EXCLUDED.error,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            updated_at = EXCLUDED.updated_at,
            payload = EXCLUDED.payload`,
          [
            s.id,
            s.status,
            s.nodeId,
            s.projectId,
            s.collabSessionId,
            s.agentId,
            s.error,
            s.createdAt,
            s.startedAt,
            s.completedAt,
            s.updatedAt,
            payload,
          ],
        );
      } catch {
        detail = 'warehouse putSummary failed';
      }
    },

    async getSummary(id) {
      const sid = sanitizeRunId(id);
      if (!sid) return null;
      if (!(await ensureReady()) || !pool) return null;
      try {
        const res = await pool.query(
          `SELECT id, status, node_id, project_id, collab_session_id, agent_id, error,
                  created_at, started_at, completed_at, updated_at, payload
           FROM ${summaryTable} WHERE id = $1`,
          [sid],
        );
        const row = res.rows[0];
        if (!row) return null;
        if (row.payload && typeof row.payload === 'object') {
          const p = sanitizeSummary(row.payload as WarehouseRunSummary);
          if (p) return p;
        }
        const iso = (v: unknown): string | null => {
          if (v == null) return null;
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'string') return v;
          return null;
        };
        return sanitizeSummary({
          id: String(row.id),
          status: String(row.status),
          nodeId: String(row.node_id),
          projectId: (row.project_id as string | null) ?? null,
          collabSessionId: (row.collab_session_id as string | null) ?? null,
          agentId: (row.agent_id as string | null) ?? null,
          error: (row.error as string | null) ?? null,
          createdAt: iso(row.created_at) ?? new Date().toISOString(),
          startedAt: iso(row.started_at),
          completedAt: iso(row.completed_at),
          updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
        });
      } catch {
        detail = 'warehouse getSummary failed';
        return null;
      }
    },

    async appendEvent(runId, event) {
      const sid = sanitizeRunId(runId);
      if (!sid) return;
      const ev = sanitizeEvent(event);
      if (!ev) return;
      if (!(await ensureReady()) || !pool) return;
      try {
        const dataJson =
          ev.data !== undefined ? JSON.stringify(ev.data) : null;
        await pool.query(
          `INSERT INTO ${eventTable} (run_id, event_id, type, ts, data)
           VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)
           ON CONFLICT (run_id, event_id) DO NOTHING`,
          [sid, ev.id, ev.type, ev.ts, dataJson],
        );
      } catch {
        detail = 'warehouse appendEvent failed';
      }
    },

    async listEventsAfter(runId, afterEventId) {
      const sid = sanitizeRunId(runId);
      if (!sid) return [];
      if (!(await ensureReady()) || !pool) return [];
      try {
        const res = await pool.query(
          `SELECT event_id, type, ts, data
           FROM ${eventTable}
           WHERE run_id = $1
           ORDER BY ts ASC, event_id ASC
           LIMIT 10000`,
          [sid],
        );
        const events: RuntimeRunEvent[] = [];
        for (const row of res.rows) {
          const ev = sanitizeEvent({
            id: String(row.event_id),
            type: String(row.type),
            ts:
              row.ts instanceof Date
                ? row.ts.toISOString()
                : String(row.ts ?? new Date().toISOString()),
            data: row.data,
          });
          if (ev) events.push(ev);
        }
        return eventsAfterInList(events, afterEventId);
      } catch {
        detail = 'warehouse listEventsAfter failed';
        return [];
      }
    },

    status() {
      return { kind, ready, detail, schema };
    },

    async close() {
      closed = true;
      ready = false;
      const p = pool;
      pool = null;
      kind = 'postgres-stub';
      detail = 'closed';
      if (p) {
        try {
          await p.end();
        } catch {
          /* ignore */
        }
      }
    },
  };

  readyPromise = (async () => {
    try {
      const mod = (await import('pg' as string)) as PgModule & {
        default?: PgModule;
      };
      if (closed) return;
      const PoolCtor = mod.Pool ?? mod.default?.Pool;
      if (!PoolCtor) {
        kind = 'postgres-stub';
        ready = false;
        detail = 'pg package missing Pool export';
        return;
      }
      const p = new PoolCtor({ connectionString: url });
      await p.query(warehouseMigrationSql(schema));
      if (closed) {
        await p.end().catch(() => {});
        return;
      }
      pool = p;
      kind = 'postgres';
      ready = true;
      detail = `schema=${schema}`;
    } catch (err) {
      kind = 'postgres-stub';
      ready = false;
      detail =
        err instanceof Error
          ? `postgres warehouse unavailable (${err.message}); install "pg" + set URL`
          : 'postgres warehouse unavailable';
      pool = null;
    }
  })();

  return store;
}

// ── Factory + singleton ─────────────────────────────────────────────────────

export function createRunWarehouse(
  env: NodeJS.ProcessEnv = process.env,
): RunWarehouse {
  const mode = resolveRunWarehouseMode(env);
  if (mode === 'off') {
    return createOffWarehouse();
  }

  const schema = resolveRunWarehouseSchema(env);
  const url = resolveRunWarehouseUrl(env);
  if (!url) {
    return createPostgresStubWarehouse(
      'NEOS_RUN_WAREHOUSE=postgres but NEOS_RUN_WAREHOUSE_URL/DATABASE_URL unset',
      schema,
    );
  }
  return createPostgresWarehouse(url, { schema });
}

let warehouse: RunWarehouse | null = null;

export function getRunWarehouse(): RunWarehouse {
  if (!warehouse) {
    warehouse = createOffWarehouse('run warehouse not initialized');
  }
  return warehouse;
}

export function initRunWarehouse(
  env: NodeJS.ProcessEnv = process.env,
): RunWarehouse {
  if (warehouse) {
    void warehouse.close();
    warehouse = null;
  }
  warehouse = createRunWarehouse(env);
  return warehouse;
}

export function shutdownRunWarehouse(): void {
  if (warehouse) {
    void warehouse.close();
    warehouse = null;
  }
}

export function resetRunWarehouseForTests(): void {
  shutdownRunWarehouse();
}

export function setRunWarehouseForTests(w: RunWarehouse | null): void {
  if (warehouse) {
    void warehouse.close();
  }
  warehouse = w;
}
