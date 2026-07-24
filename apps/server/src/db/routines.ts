/**
 * Routine CRUD operations.
 */
import { getDb } from './schema.js';

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

function rowToRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    schedule: row.schedule,
    timezone: row.timezone || 'UTC',
    enabled: row.enabled === 1,
    inputs: JSON.parse(row.inputs_json || '{}') as Record<string, unknown>,
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

export function listRoutines(): Routine[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM routine ORDER BY created_at DESC').all() as RoutineRow[];
  return rows.map(rowToRoutine);
}

export function getRoutine(id: string): Routine | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM routine WHERE id = ?').get(trimmed) as RoutineRow | undefined;
  return row ? rowToRoutine(row) : null;
}

export function createRoutine(input: {
  name: string;
  workflowId: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  inputs?: Record<string, unknown>;
}): Routine {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const timezone = input.timezone?.trim() || 'UTC';
  db.prepare(`
    INSERT INTO routine (id, name, workflow_id, schedule, timezone, enabled, inputs_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.workflowId,
    input.schedule,
    timezone,
    input.enabled !== false ? 1 : 0,
    JSON.stringify(input.inputs ?? {}),
    now,
    now,
  );
  return getRoutine(id)!;
}

export function updateRoutine(
  id: string,
  input: Partial<{ name: string; schedule: string; timezone: string; enabled: boolean; inputs: Record<string, unknown> }>,
): Routine | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  const db = getDb();
  const existing = getRoutine(trimmed);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE routine
    SET name = ?, schedule = ?, timezone = ?, enabled = ?, inputs_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.schedule ?? existing.schedule,
    input.timezone ?? existing.timezone,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    JSON.stringify(input.inputs ?? existing.inputs),
    now,
    trimmed,
  );
  return getRoutine(trimmed);
}

export function deleteRoutine(id: string): boolean {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM routine WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

export function setLastRunAt(id: string): void {
  const db = getDb();
  db.prepare("UPDATE routine SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
}

// Routine run records
export function createRoutineRun(input: { routineId: string; runId?: string }): RoutineRun {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO routine_run (id, routine_id, run_id, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(id, input.routineId, input.runId ?? null, now);
  const row = db.prepare('SELECT * FROM routine_run WHERE id = ?').get(id) as RoutineRunRow;
  return rowToRun(row);
}

export function completeRoutineRun(id: string, status: 'completed' | 'failed', error?: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE routine_run
    SET status = ?, completed_at = datetime('now'), error = ?
    WHERE id = ?
  `).run(status, error ?? null, id);
}

export function listRoutineRuns(routineId: string, limit = 20): RoutineRun[] {
  const rid = typeof routineId === 'string' ? routineId.trim() : '';
  if (!rid) return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM routine_run WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?',
  ).all(rid, limit) as RoutineRunRow[];
  return rows.map(rowToRun);
}

export function getRoutineRun(routineId: string, runId: string): RoutineRun | null {
  const rid = typeof routineId === 'string' ? routineId.trim() : '';
  const run = typeof runId === 'string' ? runId.trim() : '';
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
