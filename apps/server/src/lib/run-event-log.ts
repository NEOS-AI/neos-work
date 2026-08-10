/**
 * Durable run event log + summary + retention (v0.21 Track 1 / v0.22 M0–M1).
 *
 * Layout under `{NEOS_DATA_DIR}/runs/{runId}/`:
 *   events.jsonl  — append-only events
 *   summary.json  — last-known SharedRunSummary-shaped snapshot (v0.22 M1)
 *
 * Env:
 *   NEOS_RUN_EVENT_LOG=auto|on|off
 *   NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS  (default 168 = 7d; 0 = no age prune)
 *   NEOS_RUN_EVENT_LOG_MAX_RUNS       (default 500; 0 = no count prune)
 *   NEOS_RUN_EVENT_LOG_MAX_FILE_BYTES (default 8_388_608 = 8 MiB per events.jsonl; 0 = no trim)
 *
 * Not a Postgres warehouse: best-effort, line size capped, GC is opportunistic.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeRunEvent } from '@neos-work/agent-runtime';
import { resolveDbDir } from '../db/schema.js';

export type RunEventLogMode = 'auto' | 'on' | 'off';

const RUN_ID_MAX = 128;
const LINE_MAX = 64 * 1024;
const READ_MAX_EVENTS = 10_000;

/** Default retention: 7 days. */
export const DEFAULT_RUN_LOG_MAX_AGE_HOURS = 168;
/** Default max run directories under runs/. */
export const DEFAULT_RUN_LOG_MAX_RUNS = 500;
/** Default max size of a single events.jsonl before head-trim. */
export const DEFAULT_RUN_LOG_MAX_FILE_BYTES = 8 * 1024 * 1024;

export type DurableRunSummary = {
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

export function resolveRunEventLogMode(
  env: NodeJS.ProcessEnv = process.env,
): RunEventLogMode {
  const raw = (env.NEOS_RUN_EVENT_LOG ?? 'auto').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'on' || raw === '1' || raw === 'true') return 'on';
  return 'auto';
}

function sanitizeRunId(id: string): string | null {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return null;
  const t = id.trim();
  if (!t || t.length > RUN_ID_MAX) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(t)) return null;
  return t;
}

function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = resolveRunEventLogMode(env);
  if (mode === 'off') return false;
  return true;
}

function parseNonNegInt(raw: string | undefined, fallback: number): number {
  if (raw == null || !String(raw).trim()) return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function resolveRunLogRetention(
  env: NodeJS.ProcessEnv = process.env,
): {
  maxAgeHours: number;
  maxRuns: number;
  maxFileBytes: number;
} {
  return {
    maxAgeHours: parseNonNegInt(
      env.NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS,
      DEFAULT_RUN_LOG_MAX_AGE_HOURS,
    ),
    maxRuns: parseNonNegInt(
      env.NEOS_RUN_EVENT_LOG_MAX_RUNS,
      DEFAULT_RUN_LOG_MAX_RUNS,
    ),
    maxFileBytes: parseNonNegInt(
      env.NEOS_RUN_EVENT_LOG_MAX_FILE_BYTES,
      DEFAULT_RUN_LOG_MAX_FILE_BYTES,
    ),
  };
}

export function runsRootDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDbDir(), 'runs');
}

export function runEventLogDir(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const sid = sanitizeRunId(runId);
  if (!sid) return null;
  return path.join(runsRootDir(env), sid);
}

export function runEventLogPath(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dir = runEventLogDir(runId, env);
  if (!dir) return null;
  return path.join(dir, 'events.jsonl');
}

export function runSummaryLogPath(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dir = runEventLogDir(runId, env);
  if (!dir) return null;
  return path.join(dir, 'summary.json');
}

function serializeLine(event: RuntimeRunEvent): string | null {
  try {
    let raw = JSON.stringify({
      id: event.id,
      type: event.type,
      ts: event.ts,
      data: event.data ?? undefined,
    });
    if (raw.length > LINE_MAX) {
      raw = JSON.stringify({
        id: event.id,
        type: event.type,
        ts: event.ts,
        data: { _truncated: true, note: 'event data exceeded line cap' },
      });
    }
    if (/[\0]/.test(raw) || raw.includes('\n')) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Append one event to durable JSONL. Best-effort; never throws to callers.
 * Opportunistically trims file when over maxFileBytes.
 */
export function appendRunEventLog(
  runId: string,
  event: RuntimeRunEvent,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEnabled(env)) return false;
  const file = runEventLogPath(runId, env);
  if (!file) return false;
  const line = serializeLine(event);
  if (!line) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    maybeTrimEventLogFile(file, env);
    return true;
  } catch {
    return false;
  }
}

/** Keep the tail of events.jsonl within maxFileBytes (best-effort). */
export function maybeTrimEventLogFile(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { maxFileBytes } = resolveRunLogRetention(env);
  if (maxFileBytes <= 0) return;
  try {
    const st = fs.statSync(file);
    if (st.size <= maxFileBytes) return;
    const text = fs.readFileSync(file, 'utf8');
    // Keep roughly the last maxFileBytes of content on line boundaries.
    const sliceStart = Math.max(0, text.length - maxFileBytes);
    let body = text.slice(sliceStart);
    const nl = body.indexOf('\n');
    if (nl >= 0 && sliceStart > 0) body = body.slice(nl + 1);
    fs.writeFileSync(file, body.endsWith('\n') || !body ? body : `${body}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function parseLine(raw: string): RuntimeRunEvent | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.id !== 'string' || /[\0\r\n]/.test(o.id) || !o.id.trim()) return null;
    if (typeof o.type !== 'string' || /[\0\r\n]/.test(o.type) || !o.type.trim()) return null;
    if (typeof o.ts !== 'string' || /[\0\r\n]/.test(o.ts) || !o.ts.trim()) return null;
    return {
      id: o.id.trim(),
      type: o.type.trim() as RuntimeRunEvent['type'],
      ts: o.ts.trim(),
      data: o.data,
    };
  } catch {
    return null;
  }
}

/**
 * Read events from durable log after optional cursor. Empty if disabled / missing.
 */
export function readRunEventLogAfter(
  runId: string,
  afterEventId?: string,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeRunEvent[] {
  if (!isEnabled(env)) return [];
  const file = runEventLogPath(runId, env);
  if (!file) return [];
  try {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const out: RuntimeRunEvent[] = [];
    let seenAfter = !afterEventId;
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = parseLine(line.trim());
      if (!ev) continue;
      if (!seenAfter) {
        if (ev.id === afterEventId) seenAfter = true;
        continue;
      }
      out.push(ev);
      if (out.length >= READ_MAX_EVENTS) break;
    }
    return out;
  } catch {
    return [];
  }
}

// ── M1 durable summary ─────────────────────────────────────────────────────

function parseDurableSummary(raw: string): DurableRunSummary | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.id !== 'string' || /[\0\r\n]/.test(o.id)) return null;
    const id = o.id.trim();
    if (!id || id.length > RUN_ID_MAX) return null;
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

/** Write durable summary.json next to events.jsonl (best-effort). */
export function writeRunSummaryLog(
  summary: DurableRunSummary,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEnabled(env)) return false;
  const file = runSummaryLogPath(summary.id, env);
  if (!file) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = JSON.stringify({
      id: summary.id,
      status: summary.status,
      nodeId: summary.nodeId,
      projectId: summary.projectId,
      collabSessionId: summary.collabSessionId,
      agentId: summary.agentId,
      error: summary.error,
      createdAt: summary.createdAt,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      updatedAt: summary.updatedAt,
    });
    if (payload.includes('\0') || payload.length > 64 * 1024) return false;
    fs.writeFileSync(file, `${payload}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Read durable summary.json if present. */
export function readRunSummaryLog(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): DurableRunSummary | null {
  if (!isEnabled(env)) return null;
  const file = runSummaryLogPath(runId, env);
  if (!file) return null;
  try {
    if (!fs.existsSync(file)) return null;
    return parseDurableSummary(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ── M0 retention / GC ──────────────────────────────────────────────────────

export type PruneRunLogsResult = {
  scanned: number;
  removed: number;
  reasons: { age: number; count: number };
};

/**
 * Prune run log directories under runs/ by max age and max count.
 * Best-effort; never throws.
 */
export function pruneRunEventLogs(
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): PruneRunLogsResult {
  const result: PruneRunLogsResult = {
    scanned: 0,
    removed: 0,
    reasons: { age: 0, count: 0 },
  };
  if (!isEnabled(env)) return result;
  const root = runsRootDir(env);
  const { maxAgeHours, maxRuns } = resolveRunLogRetention(env);
  try {
    if (!fs.existsSync(root)) return result;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const dirs: Array<{ id: string; mtimeMs: number; path: string }> = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!sanitizeRunId(ent.name)) continue;
      const p = path.join(root, ent.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(p).mtimeMs;
      } catch {
        continue;
      }
      dirs.push({ id: ent.name, mtimeMs, path: p });
    }
    result.scanned = dirs.length;

    // Age prune
    if (maxAgeHours > 0) {
      const cutoff = nowMs - maxAgeHours * 3600 * 1000;
      for (const d of [...dirs]) {
        if (d.mtimeMs < cutoff) {
          try {
            fs.rmSync(d.path, { recursive: true, force: true });
            result.removed += 1;
            result.reasons.age += 1;
            const idx = dirs.indexOf(d);
            if (idx >= 0) dirs.splice(idx, 1);
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Count prune — remove oldest first
    if (maxRuns > 0 && dirs.length > maxRuns) {
      dirs.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const excess = dirs.length - maxRuns;
      for (let i = 0; i < excess; i++) {
        const d = dirs[i]!;
        try {
          fs.rmSync(d.path, { recursive: true, force: true });
          result.removed += 1;
          result.reasons.count += 1;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return result;
}

export function runEventLogStatus(env: NodeJS.ProcessEnv = process.env): {
  mode: RunEventLogMode;
  enabled: boolean;
  root: string;
  retention: ReturnType<typeof resolveRunLogRetention>;
} {
  const mode = resolveRunEventLogMode(env);
  return {
    mode,
    enabled: isEnabled(env),
    root: runsRootDir(env),
    retention: resolveRunLogRetention(env),
  };
}
