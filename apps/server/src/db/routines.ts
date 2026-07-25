import { isValidTimeZone } from '../lib/cron-next.js';
/**
 * Routine CRUD operations.
 */
import { getDb } from './schema.js';

/**
 * Lightweight schedule validation: 5 whitespace-separated cron fields.
 * Field-level tokens are checked by the estimator at schedule time; here we
 * only reject blank / wrong arity / control-char expressions.
 */
function isValidSchedule(expression: string): boolean {
  if (typeof expression !== 'string') return false;
  // Reject control chars before trim (trim would strip CR/LF)
  if (/[\0\r\n]/.test(expression)) return false;
  const expr = expression.trim();
  if (!expr) return false;
  const parts = expr.split(/\s+/);
  return parts.length === 5 && parts.every((p) => p.length > 0 && p.length <= 64);
}

export interface RoutineRow {
  id: string;
  name: string;
  workflow_id: string;
  schedule: string;
  timezone: string | null;
  enabled: number;
  inputs_json: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  name: string;
  workflowId: string;
  schedule: string;
  /** IANA timezone for cron evaluation (DST-aware via node-cron) */
  timezone: string;
  enabled: boolean;
  inputs: Record<string, unknown>;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRunRow {
  id: string;
  routine_id: string;
  run_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  runId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

function safeParseInputs(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function rowToRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    schedule: row.schedule,
    timezone: row.timezone || 'UTC',
    enabled: row.enabled === 1,
    inputs: safeParseInputs(row.inputs_json),
    lastRunAt: row.last_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RoutineRunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routine_id,
    runId: row.run_id ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  };
}

/** Practical bound for routine / run / workflow lookup ids. */
const LOOKUP_ID_MAX_CHARS = 100;

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

export function listRoutines(): Routine[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM routine ORDER BY created_at DESC').all() as RoutineRow[];
  return rows.map(rowToRoutine);
}

export function getRoutine(id: string): Routine | null {
  const trimmed = safeLookupId(id);
  if (!trimmed) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM routine WHERE id = ?').get(trimmed) as RoutineRow | undefined;
  return row ? rowToRoutine(row) : null;
}

/** Cap routine name / trigger inputs JSON (plan Task 2). */
export const ROUTINE_NAME_MAX_CHARS = 200;
export const ROUTINE_INPUTS_JSON_MAX_CHARS = 256_000;
/** Cap routine run error messages. */
export const ROUTINE_RUN_ERROR_MAX_CHARS = 4_000;

export function createRoutine(input: {
  name: string;
  workflowId: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  inputs?: Record<string, unknown>;
}): Routine {
  const nameRaw = typeof input.name === 'string' ? input.name : '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(nameRaw)) {
    throw new Error('name contains invalid control characters');
  }
  const name = nameRaw.trim();
  const rawWf = typeof input.workflowId === 'string' ? input.workflowId : '';
  if (!rawWf.trim()) {
    throw new Error('name, workflowId, and schedule are required');
  }
  const workflowId = safeLookupId(input.workflowId);
  if (!workflowId) {
    throw new Error('workflowId is invalid');
  }
  const scheduleRaw = typeof input.schedule === 'string' ? input.schedule : '';
  const schedule = scheduleRaw.trim();
  if (!name || !schedule) {
    throw new Error('name, workflowId, and schedule are required');
  }
  if (name.length > ROUTINE_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${ROUTINE_NAME_MAX_CHARS})`);
  }
  // Validate raw (pre-trim) so control chars are not stripped before check
  if (!isValidSchedule(scheduleRaw)) {
    throw new Error('schedule must be a valid 5-field cron expression');
  }
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let timezone = 'UTC';
  if (typeof input.timezone === 'string') {
    // Control-char timezone → UTC fallback (isValidTimeZone also rejects)
    if (!/[\0\r\n]/.test(input.timezone)) {
      const timezoneRaw = input.timezone.trim() || 'UTC';
      timezone = isValidTimeZone(timezoneRaw) ? timezoneRaw : 'UTC';
    }
  }
  const inputs =
    input.inputs && typeof input.inputs === 'object' && !Array.isArray(input.inputs)
      ? input.inputs
      : {};
  const inputsJson = JSON.stringify(inputs);
  if (inputsJson.length > ROUTINE_INPUTS_JSON_MAX_CHARS) {
    throw new Error(
      `inputs exceeds max size (${ROUTINE_INPUTS_JSON_MAX_CHARS} characters)`,
    );
  }
  db.prepare(`
    INSERT INTO routine (id, name, workflow_id, schedule, timezone, enabled, inputs_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    workflowId,
    schedule,
    timezone,
    input.enabled !== false ? 1 : 0,
    inputsJson,
    now,
    now,
  );
  return getRoutine(id)!;
}

export function updateRoutine(
  id: string,
  input: Partial<{ name: string; schedule: string; timezone: string; enabled: boolean; inputs: Record<string, unknown> }>,
): Routine | null {
  const trimmed = safeLookupId(id);
  if (!trimmed) return null;
  const db = getDb();
  const existing = getRoutine(trimmed);
  if (!existing) return null;

  let name = existing.name;
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name)) return null;
    name = input.name.trim();
  }
  if (!name || name.length > ROUTINE_NAME_MAX_CHARS) return null;
  if (input.schedule !== undefined) {
    if (typeof input.schedule !== 'string' || !isValidSchedule(input.schedule)) return null;
  }
  const schedule =
    input.schedule !== undefined
      ? input.schedule.trim()
      : existing.schedule;
  if (!schedule) return null;
  let timezone = existing.timezone;
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== 'string' || /[\0\r\n]/.test(input.timezone)) {
      timezone = 'UTC';
    } else {
      const raw = input.timezone.trim() || 'UTC';
      timezone = isValidTimeZone(raw) ? raw : 'UTC';
    }
  }

  const now = new Date().toISOString();
  // Non-object inputs (arrays/primitives) → {} — matches webhook trigger hygiene
  const inputs =
    input.inputs !== undefined
      ? input.inputs && typeof input.inputs === 'object' && !Array.isArray(input.inputs)
        ? input.inputs
        : {}
      : existing.inputs;
  const inputsJson = JSON.stringify(inputs);
  if (inputsJson.length > ROUTINE_INPUTS_JSON_MAX_CHARS) return null;
  db.prepare(`
    UPDATE routine
    SET name = ?, schedule = ?, timezone = ?, enabled = ?, inputs_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    schedule,
    timezone,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    inputsJson,
    now,
    trimmed,
  );
  return getRoutine(trimmed);
}

export function deleteRoutine(id: string): boolean {
  const trimmed = safeLookupId(id);
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM routine WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function setLastRunAt(id: string): void {
  const trimmed = safeLookupId(id);
  if (!trimmed) return;
  const db = getDb();
  db.prepare("UPDATE routine SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(trimmed);
}

// Routine run records
export function createRoutineRun(input: { routineId: string; runId?: string }): RoutineRun {
  const rawRid = typeof input.routineId === 'string' ? input.routineId : '';
  if (!rawRid.trim()) throw new Error('routineId is required');
  const routineId = safeLookupId(input.routineId);
  if (!routineId) throw new Error('routineId is invalid');
  let runId: string | null = null;
  if (input.runId !== undefined && input.runId !== null) {
    if (typeof input.runId === 'string') {
      // Drop unsafe linked workflow run ids rather than persisting them
      runId = safeLookupId(input.runId) || null;
    }
  }
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO routine_run (id, routine_id, run_id, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(id, routineId, runId, now);
  const row = db.prepare('SELECT * FROM routine_run WHERE id = ?').get(id) as RoutineRunRow;
  return rowToRun(row);
}

export function completeRoutineRun(id: string, status: 'completed' | 'failed', error?: string): void {
  const trimmed = safeLookupId(id);
  if (!trimmed) return;
  // Control-char status → completed fallback (check before trim)
  const statusRaw =
    typeof status === 'string' && !/[\0\r\n]/.test(status)
      ? status.trim().toLowerCase()
      : '';
  const normalized: 'completed' | 'failed' = statusRaw === 'failed' ? 'failed' : 'completed';
  // Scrub control chars from error text before trim (align with agent-steps)
  let errorVal: string | null = null;
  if (typeof error === 'string') {
    errorVal = error.replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim() || null;
  } else if (error != null) {
    errorVal = String(error).replace(/[\r\n]+/g, ' ').trim() || null;
  }
  if (errorVal && errorVal.length > ROUTINE_RUN_ERROR_MAX_CHARS) {
    errorVal = errorVal.slice(0, ROUTINE_RUN_ERROR_MAX_CHARS);
  }
  const db = getDb();
  db.prepare(`
    UPDATE routine_run
    SET status = ?, completed_at = datetime('now'), error = ?
    WHERE id = ?
  `).run(normalized, errorVal, trimmed);
}

export function listRoutineRuns(routineId: string, limit = 20): RoutineRun[] {
  const rid = safeLookupId(routineId);
  if (!rid) return [];
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM routine_run WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?',
  ).all(rid, capped) as RoutineRunRow[];
  return rows.map(rowToRun);
}

export function getRoutineRun(routineId: string, runId: string): RoutineRun | null {
  const rid = safeLookupId(routineId);
  const run = safeLookupId(runId);
  if (!rid || !run) return null;
  const db = getDb();
  // `runId` may be the routine_run primary key or the linked workflow_run id
  const row = db.prepare(
    `SELECT * FROM routine_run
     WHERE routine_id = ? AND (id = ? OR run_id = ?)
     LIMIT 1`,
  ).get(rid, run, run) as RoutineRunRow | undefined;
  return row ? rowToRun(row) : null;
}
