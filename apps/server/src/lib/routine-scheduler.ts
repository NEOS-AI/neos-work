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
import * as workflowDb from '../db/workflows.js';
import { executeWorkflow } from '@neos-work/workflow-engine';
import { getWorkflowSecrets } from '../db/settings.js';
import { spawnCliAgent } from './cli-agents.js';
import { getDesignSystemContent } from './design-system-store.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from './runtime-context.js';

const scheduledTasks = new Map<string, cron.ScheduledTask>();

function scheduleRoutine(routineId: string, schedule: string, timezone = 'UTC'): void {
  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.warn(`[Scheduler] Invalid cron expression for routine ${routineId}: ${schedule}`);
    return;
  }

  // IANA timezone → node-cron applies local wall-clock rules including DST
  const tz = timezone.trim() || 'UTC';
  const task = cron.schedule(schedule, async () => {
    await runRoutine(routineId);
  }, {
    timezone: tz,
  });

  scheduledTasks.set(routineId, task);
  task.start();
  console.log(`[Scheduler] Scheduled routine ${routineId} with cron: ${schedule} (${tz})`);
}

export async function runRoutine(routineId: string): Promise<string | null> {
  const routine = getRoutine(routineId);
  if (!routine || !routine.enabled) return null;

  const wf = workflowDb.getWorkflow(routine.workflowId);
  if (!wf) {
    console.error(`[Scheduler] Workflow ${routine.workflowId} not found for routine ${routineId}`);
    return null;
  }

  const runRecord = createRoutineRun({ routineId });
  setLastRunAt(routineId);

  try {
    const settings = getWorkflowSecrets();
    const designSystemContent = wf.designSystemId
      ? (await getDesignSystemContent(wf.designSystemId)) ?? undefined
      : undefined;

    const runId = crypto.randomUUID();

    workflowDb.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'running',
      nodeResults: {},
      startedAt: new Date().toISOString(),
    });

    const nodeResults: Record<string, unknown> = {};

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
        spawnCliAgent({
          cliId,
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

    workflowDb.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'completed',
      nodeResults: nodeResults as never,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    completeRoutineRun(runRecord.id, 'completed');
    console.log(`[Scheduler] Routine ${routineId} completed, runId: ${runId}`);
    return runId;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Execution error';
    completeRoutineRun(runRecord.id, 'failed', errorMsg);
    console.error(`[Scheduler] Routine ${routineId} failed: ${errorMsg}`);
    return null;
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
  // Remove existing task
  const existing = scheduledTasks.get(routineId);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(routineId);
  }

  if (enabled) {
    scheduleRoutine(routineId, schedule, timezone);
  }
}

export function removeSchedule(routineId: string): void {
  const task = scheduledTasks.get(routineId);
  if (task) {
    task.stop();
    scheduledTasks.delete(routineId);
    console.log(`[Scheduler] Removed schedule for routine ${routineId}`);
  }
}
