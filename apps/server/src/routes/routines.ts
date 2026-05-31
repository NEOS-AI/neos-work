/**
 * Automation Routine REST routes.
 * GET    /api/routines          — list routines
 * POST   /api/routines          — create routine
 * GET    /api/routines/:id      — get routine
 * PUT    /api/routines/:id      — update routine (name/schedule/enabled/inputs)
 * DELETE /api/routines/:id      — delete routine
 * POST   /api/routines/:id/run  — manual run
 * GET    /api/routines/:id/runs — list run history
 */

import { Hono } from 'hono';
import * as db from '../db/routines.js';
import * as workflowDb from '../db/workflows.js';
import { addOrUpdateSchedule, removeSchedule, runRoutine } from '../lib/routine-scheduler.js';

const routines = new Hono();

routines.get('/', (c) => {
  return c.json({ ok: true, data: db.listRoutines() });
});

routines.get('/:id', (c) => {
  const routine = db.getRoutine(c.req.param('id'));
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: routine });
});

routines.post('/', async (c) => {
  const body = await c.req.json<{
    name?: string;
    workflowId?: string;
    schedule?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }>();

  if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (!body.workflowId || typeof body.workflowId !== 'string') {
    return c.json({ ok: false, error: 'workflowId is required' }, 400);
  }
  if (!body.schedule || typeof body.schedule !== 'string') {
    return c.json({ ok: false, error: 'schedule is required' }, 400);
  }

  // Validate workflow exists
  const wf = workflowDb.getWorkflow(body.workflowId);
  if (!wf) return c.json({ ok: false, error: 'Workflow not found' }, 404);

  const routine = db.createRoutine({
    name: body.name,
    workflowId: body.workflowId,
    schedule: body.schedule,
    enabled: body.enabled !== false,
    inputs: body.inputs,
  });

  if (routine.enabled) {
    addOrUpdateSchedule(routine.id, routine.schedule, true);
  }

  return c.json({ ok: true, data: routine }, 201);
});

routines.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    schedule?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }>();

  const updated = db.updateRoutine(id, {
    name: body.name,
    schedule: body.schedule,
    enabled: body.enabled,
    inputs: body.inputs,
  });
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);

  // Sync scheduler
  addOrUpdateSchedule(updated.id, updated.schedule, updated.enabled);

  return c.json({ ok: true, data: updated });
});

routines.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = db.deleteRoutine(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  removeSchedule(id);
  return c.json({ ok: true });
});

routines.post('/:id/run', async (c) => {
  const id = c.req.param('id');
  const routine = db.getRoutine(id);
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);

  const runId = await runRoutine(id);
  if (!runId) {
    return c.json({ ok: false, error: 'Failed to execute routine' }, 500);
  }
  return c.json({ ok: true, data: { runId } });
});

routines.get('/:id/runs', (c) => {
  const id = c.req.param('id');
  const routine = db.getRoutine(id);
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const runs = db.listRoutineRuns(id, limit);
  return c.json({ ok: true, data: runs });
});

export default routines;
