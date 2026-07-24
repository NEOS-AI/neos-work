import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import * as workflows from './workflows.js';
import {
  completeRoutineRun,
  createRoutine,
  createRoutineRun,
  deleteRoutine,
  getRoutine,
  getRoutineRun,
  listRoutineRuns,
  listRoutines,
  setLastRunAt,
  updateRoutine,
} from './routines.js';

const WF_NAME = `_cov_rtn_${process.pid}`;

function cleanup() {
  const db = getDb();
  const wfs = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const w of wfs) {
    const routines = db.prepare('SELECT id FROM routine WHERE workflow_id = ?').all(w.id) as Array<{ id: string }>;
    for (const r of routines) {
      db.prepare('DELETE FROM routine_run WHERE routine_id = ?').run(r.id);
      db.prepare('DELETE FROM routine WHERE id = ?').run(r.id);
    }
    db.prepare('DELETE FROM workflow WHERE id = ?').run(w.id);
  }
}

afterEach(cleanup);

describe('routines CRUD', () => {
  it('creates, lists, updates, toggles, and deletes', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'Daily',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'Asia/Seoul',
      inputs: { foo: 1 },
    });
    expect(r.timezone).toBe('Asia/Seoul');
    expect(r.enabled).toBe(true);
    expect(r.inputs).toEqual({ foo: 1 });
    expect(listRoutines().some((x) => x.id === r.id)).toBe(true);
    expect(getRoutine(r.id)?.name).toBe('Daily');

    const updated = updateRoutine(r.id, { enabled: false, schedule: '0 10 * * *' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.schedule).toBe('0 10 * * *');

    setLastRunAt(r.id);
    expect(getRoutine(r.id)?.lastRunAt).toBeTruthy();

    expect(deleteRoutine(r.id)).toBe(true);
    expect(getRoutine(r.id)).toBeNull();
  });

  it('defaults timezone to UTC when omitted', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'Hourly',
      workflowId: wf.id,
      schedule: '0 * * * *',
    });
    expect(r.timezone).toBe('UTC');
  });

  it('rejects blank name, workflowId, or schedule on create', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(() =>
      createRoutine({ name: '  ', workflowId: wf.id, schedule: '0 9 * * *' }),
    ).toThrow(/name, workflowId, and schedule/i);
    expect(() =>
      createRoutine({ name: 'Daily', workflowId: '   ', schedule: '0 9 * * *' }),
    ).toThrow(/name, workflowId, and schedule/i);
    expect(() =>
      createRoutine({ name: 'Daily', workflowId: wf.id, schedule: '  ' }),
    ).toThrow(/name, workflowId, and schedule/i);
  });

  it('rejects blank routineId on createRoutineRun', () => {
    expect(() => createRoutineRun({ routineId: '   ' })).toThrow(/routineId/i);
  });

  it('trims ids; blank get/update/delete/run lookup short-circuit', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'Trim Me',
      workflowId: wf.id,
      schedule: '0 9 * * *',
    });
    expect(getRoutine(`  ${r.id}  `)?.name).toBe('Trim Me');
    expect(getRoutine('   ')).toBeNull();
    expect(updateRoutine('  ', { enabled: false })).toBeNull();
    expect(updateRoutine(`  ${r.id}  `, { enabled: false })?.enabled).toBe(false);
    expect(deleteRoutine('   ')).toBe(false);

    const run = createRoutineRun({ routineId: r.id });
    expect(listRoutineRuns('   ')).toEqual([]);
    expect(listRoutineRuns(`  ${r.id}  `).some((x) => x.id === run.id)).toBe(true);
    expect(getRoutineRun('  ', run.id)).toBeNull();
    expect(getRoutineRun(r.id, '   ')).toBeNull();
    expect(getRoutineRun(`  ${r.id}  `, `  ${run.id}  `)?.id).toBe(run.id);

    expect(deleteRoutine(`  ${r.id}  `)).toBe(true);
  });
});

describe('routine runs', () => {
  it('creates runs, completes them, lists, and looks up by pk or workflow run id', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'R',
      workflowId: wf.id,
      schedule: '*/5 * * * *',
    });
    const workflowRunId = crypto.randomUUID();
    const run = createRoutineRun({ routineId: r.id, runId: workflowRunId });
    expect(run.status).toBe('running');
    expect(run.runId).toBe(workflowRunId);

    completeRoutineRun(run.id, 'completed');
    const listed = listRoutineRuns(r.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('completed');
    expect(listed[0]?.completedAt).toBeTruthy();

    expect(getRoutineRun(r.id, run.id)?.id).toBe(run.id);
    expect(getRoutineRun(r.id, workflowRunId)?.id).toBe(run.id);

    const failed = createRoutineRun({ routineId: r.id });
    completeRoutineRun(failed.id, 'failed', 'boom');
    expect(getRoutineRun(r.id, failed.id)?.error).toBe('boom');

    const failed2 = createRoutineRun({ routineId: r.id });
    completeRoutineRun(`  ${failed2.id}  `, 'failed', '  padded error  ');
    expect(getRoutineRun(r.id, failed2.id)?.error).toBe('padded error');
    completeRoutineRun(failed2.id, 'failed', '   ');
    // blank error stored as NULL → mapped to undefined on the row model
    expect(getRoutineRun(r.id, failed2.id)?.error).toBeUndefined();
  });

  it('completeRoutineRun normalizes status case', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'R-case',
      workflowId: wf.id,
      schedule: '0 9 * * *',
    });
    const run = createRoutineRun({ routineId: r.id });
    completeRoutineRun(run.id, '  FAILED  ' as never, '  boom  ');
    const found = getRoutineRun(r.id, run.id);
    expect(found?.status).toBe('failed');
    expect(found?.error).toBe('boom');
    // non-failed normalizes to completed
    const run2 = createRoutineRun({ routineId: r.id });
    completeRoutineRun(run2.id, '  COMPLETED  ' as never);
    expect(getRoutineRun(r.id, run2.id)?.status).toBe('completed');
  });

  it('falls back invalid timezone to UTC on create/update', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const r = createRoutine({
      name: 'tz-bad',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'Not/AZone',
    });
    expect(r.timezone).toBe('UTC');
    const updated = updateRoutine(r.id, { timezone: 'Also/Invalid' });
    expect(updated?.timezone).toBe('UTC');
    const ok = updateRoutine(r.id, { timezone: '  Asia/Seoul  ' });
    expect(ok?.timezone).toBe('Asia/Seoul');
  });
});
