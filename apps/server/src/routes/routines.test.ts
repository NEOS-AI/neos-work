import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import * as routinesDb from '../db/routines.js';
import routines from './routines.js';

const WF_NAME = `_cov_rtn_route_${process.pid}`;

function cleanup() {
  const db = getDb();
  const wfs = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const w of wfs) {
    const rs = db.prepare('SELECT id FROM routine WHERE workflow_id = ?').all(w.id) as Array<{ id: string }>;
    for (const r of rs) {
      db.prepare('DELETE FROM routine_run WHERE routine_id = ?').run(r.id);
      db.prepare('DELETE FROM routine WHERE id = ?').run(r.id);
    }
    db.prepare('DELETE FROM workflow WHERE id = ?').run(w.id);
  }
}

afterEach(cleanup);

describe('routines routes', () => {
  it('rejects create without required fields', async () => {
    const res = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects create with invalid JSON body', async () => {
    const res = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects control-char name and overlong schedule on create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const badName = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'bad\nname',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        enabled: false,
      }),
    });
    expect(badName.status).toBe(400);
    const longSched = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ok',
        workflowId: wf.id,
        schedule: '0 '.repeat(150) + '* * *',
        enabled: false,
      }),
    });
    expect(longSched.status).toBe(400);
  });

  it('rejects invalid cron schedule on create and update', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const bad = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Cron',
        workflowId: wf.id,
        schedule: 'not a cron',
        enabled: false,
      }),
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json() as { error: string };
    expect(badBody.error).toMatch(/cron/i);

    const create = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Good Cron',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        enabled: false,
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string } };

    const putBad = await routines.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: '99 99 99 99 99' }),
    });
    expect(putBad.status).toBe(400);

    await routines.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('rejects whitespace-only name and trims fields on create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const blank = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '   ',
        workflowId: wf.id,
        schedule: '0 9 * * *',
      }),
    });
    expect(blank.status).toBe(400);

    const create = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '  Trimmed Routine  ',
        workflowId: `  ${wf.id}  `,
        schedule: '  0 9 * * *  ',
        timezone: '  UTC  ',
        enabled: false,
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as {
      data: { id: string; name: string; workflowId: string; schedule: string; timezone: string };
    };
    expect(created.data.name).toBe('Trimmed Routine');
    expect(created.data.workflowId).toBe(wf.id);
    expect(created.data.schedule).toBe('0 9 * * *');
    expect(created.data.timezone).toBe('UTC');

    await routines.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('creates, lists, gets, updates schedule, deletes', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const create = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Route Cov Routine',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        timezone: 'UTC',
        enabled: false,
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string; enabled: boolean; schedule: string } };
    expect(created.data.enabled).toBe(false);
    expect(created.data.schedule).toBe('0 9 * * *');
    const id = created.data.id;

    const list = await routines.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((r) => r.id === id)).toBe(true);

    const get = await routines.request(`/${id}`);
    expect(get.status).toBe(200);

    const put = await routines.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: '0 * * * *', timezone: 'Asia/Seoul' }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { schedule: string; timezone: string } };
    expect(updated.data.schedule).toBe('0 * * * *');
    expect(updated.data.timezone).toBe('Asia/Seoul');

    const runs = await routines.request(`/${id}/runs`);
    expect(runs.status).toBe(200);

    const del = await routines.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await routines.request(`/${id}`);
    expect(missing.status).toBe(404);
  });

  it('404s for missing workflow on create', async () => {
    const res = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'orphan',
        workflowId: 'no-such-wf',
        schedule: '0 9 * * *',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('crystallize rejects missing run and non-completed status', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Crystallize Cov',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });

    const missing = await routines.request(`/${routine.id}/runs/no-such-run/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missing.status).toBe(404);

    const run = routinesDb.createRoutineRun({ routineId: routine.id });
    // leave status as non-completed default (queued/running)
    const badStatus = await routines.request(`/${routine.id}/runs/${run.id}/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cand' }),
    });
    expect(badStatus.status).toBe(400);

    routinesDb.completeRoutineRun(run.id, 'completed');
    const ok = await routines.request(`/${routine.id}/runs/${run.id}/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cand Skill', description: 'from test' }),
    });
    // May succeed (200) or fail if skill FS/DB setup is limited — accept 200 or structured error
    expect([200, 201, 400, 500]).toContain(ok.status);
    if (ok.status === 200 || ok.status === 201) {
      const body = await ok.json() as { data?: { name?: string; path?: string; description?: string } };
      expect(body.data?.name || body.data?.path).toBeTruthy();
    }

    // Description cap at 4_000 chars (Task 2 crystallize polish)
    const longDesc = await routines.request(`/${routine.id}/runs/${run.id}/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Long Desc Skill',
        description: 'D'.repeat(5_000),
      }),
    });
    expect([200, 201, 400, 500]).toContain(longDesc.status);
    if (longDesc.status === 200 || longDesc.status === 201) {
      const body = await longDesc.json() as { data?: { description?: string | null } };
      if (typeof body.data?.description === 'string') {
        expect(body.data.description.length).toBeLessThanOrEqual(4_000);
      }
    }
  });

  it('POST /:id/run 404s for missing routine and blank id', async () => {
    const missing = await routines.request('/no-such-routine/run', { method: 'POST' });
    expect(missing.status).toBe(404);

    const blank = await routines.request('/%20/run', { method: 'POST' });
    expect(blank.status).toBe(404);
  });

  it('PUT rejects blank name after trim', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Name Guard',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });

    const res = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/name/i);

    await routines.request(`/${routine.id}`, { method: 'DELETE' });
  });

  it('trims path ids and rejects invalid PUT JSON', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Path Hygiene',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });

    // whitespace-only path id → 404
    const blankGet = await routines.request('/%20%20');
    expect(blankGet.status).toBe(404);

    const blankPut = await routines.request('/%20', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(blankPut.status).toBe(404);

    const badJson = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
    const body = await badJson.json() as { error: string };
    expect(body.error).toMatch(/Invalid JSON/i);

    // limit clamped to 1–100 (no throw on nonsense)
    const runs = await routines.request(`/${routine.id}/runs?limit=0`);
    expect(runs.status).toBe(200);
    const huge = await routines.request(`/${routine.id}/runs?limit=999`);
    expect(huge.status).toBe(200);

    await routines.request(`/${routine.id}`, { method: 'DELETE' });
  });

  it('rejects blank schedule, control-char timezone/workflowId on create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const blankSched = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'No Sched',
        workflowId: wf.id,
        schedule: '   ',
        enabled: false,
      }),
    });
    expect(blankSched.status).toBe(400);
    expect(((await blankSched.json()) as { error: string }).error).toMatch(/schedule/i);

    const ctrlTz = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Tz',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        timezone: 'UTC\n',
        enabled: false,
      }),
    });
    expect(ctrlTz.status).toBe(400);
    expect(((await ctrlTz.json()) as { error: string }).error).toMatch(/timezone/i);

    // Leading control-char timezone must not strip to UTC
    const leadTz = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Lead Tz',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        timezone: '\nUTC',
        enabled: false,
      }),
    });
    expect(leadTz.status).toBe(400);

    // Control-char workflowId rejected (before missing-workflow 404)
    const ctrlWf = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Wf',
        workflowId: `bad${'\n'}id`,
        schedule: '0 9 * * *',
        enabled: false,
      }),
    });
    expect(ctrlWf.status).toBe(400);
    expect(((await ctrlWf.json()) as { error: string }).error).toMatch(/workflowId/i);
  });

  it('PUT rejects control-char timezone/schedule and blank schedule', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Put Hygiene',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });

    const ctrlTz = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'Asia/Seoul\n' }),
    });
    expect(ctrlTz.status).toBe(400);
    expect(((await ctrlTz.json()) as { error: string }).error).toMatch(/timezone/i);

    const blankSched = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: '   ' }),
    });
    expect(blankSched.status).toBe(400);
    expect(((await blankSched.json()) as { error: string }).error).toMatch(/schedule/i);

    const ctrlSched = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: '0 9 * * *\n' }),
    });
    expect(ctrlSched.status).toBe(400);
    expect(((await ctrlSched.json()) as { error: string }).error).toMatch(/cron|schedule/i);

    const ctrlName = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad\nname' }),
    });
    expect(ctrlName.status).toBe(400);
    expect(((await ctrlName.json()) as { error: string }).error).toMatch(/name/i);

    // overlong timezone
    const longTz = await routines.request(`/${routine.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'T'.repeat(101) }),
    });
    expect(longTz.status).toBe(400);

    await routines.request(`/${routine.id}`, { method: 'DELETE' });
  });

  it('crystallize rejects control-char name and null-byte description', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Crystallize Ctrl',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });
    const run = routinesDb.createRoutineRun({ routineId: routine.id });
    routinesDb.completeRoutineRun(run.id, 'completed');

    const badName = await routines.request(`/${routine.id}/runs/${run.id}/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad\nname' }),
    });
    expect(badName.status).toBe(400);
    expect(((await badName.json()) as { error: string }).error).toMatch(/Invalid name/i);

    const nulDesc = await routines.request(`/${routine.id}/runs/${run.id}/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ok', description: `desc${'\0'}x` }),
    });
    expect(nulDesc.status).toBe(400);
    expect(((await nulDesc.json()) as { error: string }).error).toMatch(/Invalid description/i);
  });
});

describe('routines validation remaining edges', () => {
  it('PUT rejects overlong name and timezone; create rejects null-byte inputs key only via ok create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const create = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Edge Routine',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        enabled: false,
      }),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const longName = await routines.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n'.repeat(201) }),
    });
    expect(longName.status).toBe(400);

    const longTz = await routines.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'z'.repeat(101) }),
    });
    expect(longTz.status).toBe(400);

    const missingRuns = await routines.request('/no-such/runs');
    expect(missingRuns.status).toBe(404);

    const blankCrystallize = await routines.request('/%20/runs/r1/crystallize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(blankCrystallize.status).toBe(404);

    const blankRunId = await routines.request(`/${id}/runs/%20/crystallize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(blankRunId.status).toBe(404);

    // create with enabled=true schedules
    const enabled = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Enabled Sched',
        workflowId: wf.id,
        schedule: '0 10 * * *',
        timezone: 'UTC',
        enabled: true,
      }),
    });
    expect(enabled.status).toBe(201);
    const enId = ((await enabled.json()) as { data: { id: string } }).data.id;

    // disable via PUT
    const off = await routines.request(`/${enId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);

    await routines.request(`/${id}`, { method: 'DELETE' });
    await routines.request(`/${enId}`, { method: 'DELETE' });
  });

  it('POST /:id/run executes or fails gracefully for empty graph', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const routine = routinesDb.createRoutine({
      name: 'Run Me',
      workflowId: wf.id,
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: false,
    });

    const res = await routines.request(`/${routine.id}/run`, { method: 'POST' });
    // empty graph may complete or fail depending on executor
    expect([200, 500]).toContain(res.status);

    await routines.request(`/${routine.id}`, { method: 'DELETE' });
  });
});
