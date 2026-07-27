/**
 * Automation Routine Scheduler using node-cron.
 * Schedules enabled routines and executes workflows on cron trigger.
 */
import * as cron from 'node-cron';
import {
  listRoutines,
  getRoutine,
  setLastRunAt,
  createRoutineRun,
  completeRoutineRun,
} from '../db/routines.js';
import { scrubErrorMessage } from '@neos-work/core';
import { executeWorkflow } from '@neos-work/workflow-engine';

import * as workflowDb from '../db/workflows.js';
import { getExecutionSettings } from '../db/settings.js';
import { spawnRegistryAgent } from './registry-spawn.js';
import { getDesignSystemContent } from './design-system-store.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from './runtime-context.js';
import { createFirstHtmlArtifact } from './html-artifact.js';
import * as artifactDb from '../db/artifacts.js';

const scheduledTasks = new Map<string, cron.ScheduledTask>();
/** In-memory lock: prevent overlapping runs of the same routine (plan Task 2). */
const runningRoutines = new Set<string>();

/** Align with routines routes: id ≤ 100, schedule ≤ 200, timezone ≤ 100. */
const ROUTINE_ID_MAX = 100;
const CRON_EXPR_MAX = 200;
const TIMEZONE_MAX = 100;

function sanitizeRoutineId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > ROUTINE_ID_MAX) return '';
  return id;
}

function sanitizeCronExpr(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const expr = raw.trim();
  if (!expr || expr.length > CRON_EXPR_MAX) return '';
  return expr;
}

function sanitizeTimezone(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'UTC';
  const tz = raw.trim() || 'UTC';
  if (tz.length > TIMEZONE_MAX) return 'UTC';
  return tz;
}

function scheduleRoutine(routineId: string, schedule: string, timezone = 'UTC'): void {
  const id = sanitizeRoutineId(routineId);
  if (!id) return;
  const cronExpr = sanitizeCronExpr(schedule);
  // Validate cron expression
  if (!cronExpr || !cron.validate(cronExpr)) {
    console.warn(`[Scheduler] Invalid cron expression for routine ${id}: ${schedule}`);
    return;
  }

  // IANA timezone → node-cron applies local wall-clock rules including DST
  const tz = sanitizeTimezone(timezone);
  const task = cron.schedule(cronExpr, async () => {
    await runRoutine(id);
  }, {
    timezone: tz,
  });

  scheduledTasks.set(id, task);
  task.start();
  console.log(`[Scheduler] Scheduled routine ${id} with cron: ${cronExpr} (${tz})`);
}

/** Test helper — whether a routine is currently locked as running. */
export function isRoutineRunning(routineId: string): boolean {
  const id = sanitizeRoutineId(routineId);
  return id ? runningRoutines.has(id) : false;
}

export async function runRoutine(routineId: string): Promise<string | null> {
  const id = sanitizeRoutineId(routineId);
  if (!id) return null;
  // Skip overlapping schedule/manual triggers for the same routine
  if (runningRoutines.has(id)) {
    console.warn(`[Scheduler] Routine ${id} already running — skip overlapping trigger`);
    return null;
  }
  const routine = getRoutine(id);
  if (!routine || !routine.enabled) return null;

  const wf = workflowDb.getWorkflow(routine.workflowId);
  if (!wf) {
    console.error(`[Scheduler] Workflow ${routine.workflowId} not found for routine ${id}`);
    return null;
  }

  runningRoutines.add(id);
  const runRecord = createRoutineRun({ routineId: id });
  setLastRunAt(id);

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const nodeResults: Record<string, unknown> = {};

  try {
    const settings = getExecutionSettings({
      serverUrl: getRuntimeServerUrl(),
      authToken: getRuntimeAuthToken(),
    });
    const designSystemContent = wf.designSystemId
      ? (await getDesignSystemContent(wf.designSystemId)) ?? undefined
      : undefined;

    workflowDb.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'running',
      nodeResults: {},
      startedAt,
    });

    await executeWorkflow({
      runId,
      triggerInputs: routine.inputs,
      workflow: wf,
      settings,
      onEvent: (event) => {
        if (event.type === 'node.completed') {
          nodeResults[event.nodeId] = { status: 'completed', output: event.output };
        }
        if (event.type === 'node.failed') {
          nodeResults[event.nodeId] = { status: 'failed', error: event.error };
        }
      },
      cliSpawn: (cliId, prompt, onChunk, signal) =>
        spawnRegistryAgent({
          agentId: cliId,
          prompt,
          onChunk,
          signal,
          workflowId: wf.id,
          runId,
          serverUrl: getRuntimeServerUrl(),
          authToken: getRuntimeAuthToken(),
        }),
      designSystemContent,
    });

    // Auto-detect HTML artifacts for scheduled runs
    createFirstHtmlArtifact({
      workflowId: wf.id,
      runId,
      nodeResults,
      create: (input) => artifactDb.createArtifact(input),
    });

    workflowDb.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'completed',
      nodeResults: nodeResults as never,
      startedAt,
      completedAt: new Date().toISOString(),
    });

    completeRoutineRun(runRecord.id, 'completed');
    console.log(`[Scheduler] Routine ${id} completed, runId: ${runId}`);
    return runId;
  } catch (err) {
    const errorMsg =
      scrubErrorMessage(err instanceof Error ? err.message : 'Execution error', 4_000)
      || 'Execution error';
    // Persist failed workflow run so history does not leave rows stuck as "running"
    workflowDb.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'failed',
      nodeResults: nodeResults as never,
      startedAt,
      completedAt: new Date().toISOString(),
      error: errorMsg,
    });
    completeRoutineRun(runRecord.id, 'failed', errorMsg);
    console.error(`[Scheduler] Routine ${id} failed: ${errorMsg}`);
    return null;
  } finally {
    runningRoutines.delete(id);
  }
}

export function initScheduler(): void {
  const routines = listRoutines();
  for (const routine of routines) {
    if (routine.enabled) {
      scheduleRoutine(routine.id, routine.schedule, routine.timezone);
    }
  }
  console.log(`[Scheduler] Initialized ${routines.filter((r) => r.enabled).length} routines`);
}

export function addOrUpdateSchedule(
  routineId: string,
  schedule: string,
  enabled: boolean,
  timezone = 'UTC',
): void {
  const id = sanitizeRoutineId(routineId);
  if (!id) return;
  // Remove existing task
  const existing = scheduledTasks.get(id);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(id);
  }

  if (enabled) {
    scheduleRoutine(id, schedule, timezone);
  }
}

export function removeSchedule(routineId: string): void {
  const id = sanitizeRoutineId(routineId);
  if (!id) return;
  const task = scheduledTasks.get(id);
  if (task) {
    task.stop();
    scheduledTasks.delete(id);
    console.log(`[Scheduler] Removed schedule for routine ${id}`);
  }
}
