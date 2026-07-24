/**
 * Automation Routine REST routes.
 * GET    /api/routines          — list routines
 * POST   /api/routines          — create routine
 * GET    /api/routines/:id      — get routine
 * PUT    /api/routines/:id      — update routine (name/schedule/enabled/inputs)
 * DELETE /api/routines/:id      — delete routine
 * POST   /api/routines/:id/run  — manual run
 * GET    /api/routines/:id/runs — list run history
 * POST   /api/routines/:id/runs/:runId/crystallize — success run → skill candidate
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import * as db from '../db/routines.js';
import * as workflowDb from '../db/workflows.js';
import { getDb } from '../db/schema.js';
import { addOrUpdateSchedule, removeSchedule, runRoutine } from '../lib/routine-scheduler.js';
import { estimateNextCronRun } from '../lib/cron-next.js';

const routines = new Hono();

function withNextRun<T extends { schedule: string; timezone: string; enabled: boolean }>(
  routine: T,
): T & { nextRunAt?: string } {
  if (!routine.enabled) return { ...routine };
  const next = estimateNextCronRun(routine.schedule, { timezone: routine.timezone || 'UTC' });
  return {
    ...routine,
    nextRunAt: next?.toISOString(),
  };
}

routines.get('/', (c) => {
  return c.json({ ok: true, data: db.listRoutines().map(withNextRun) });
});

routines.get('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const routine = db.getRoutine(id);
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: withNextRun(routine) });
});

routines.post('/', async (c) => {
  const body = await c.req.json<{
    name?: string;
    workflowId?: string;
    schedule?: string;
    timezone?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }>();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : '';
  const schedule = typeof body.schedule === 'string' ? body.schedule.trim() : '';
  const timezone =
    typeof body.timezone === 'string' ? body.timezone.trim() || undefined : undefined;

  if (!name || name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (!workflowId) {
    return c.json({ ok: false, error: 'workflowId is required' }, 400);
  }
  if (!schedule) {
    return c.json({ ok: false, error: 'schedule is required' }, 400);
  }

  // Validate workflow exists
  const wf = workflowDb.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Workflow not found' }, 404);

  const routine = db.createRoutine({
    name,
    workflowId,
    schedule,
    timezone,
    enabled: body.enabled !== false,
    inputs: body.inputs,
  });

  if (routine.enabled) {
    addOrUpdateSchedule(routine.id, routine.schedule, true, routine.timezone);
  }

  return c.json({ ok: true, data: routine }, 201);
});

routines.put('/:id', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{
    name?: string;
    schedule?: string;
    timezone?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const name =
    body.name !== undefined
      ? (typeof body.name === 'string' ? body.name.trim() : '')
      : undefined;
  if (name !== undefined && (!name || name.length > 200)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  const schedule =
    body.schedule !== undefined
      ? (typeof body.schedule === 'string' ? body.schedule.trim() : '')
      : undefined;
  if (schedule !== undefined && !schedule) {
    return c.json({ ok: false, error: 'schedule is required' }, 400);
  }
  const timezone =
    body.timezone !== undefined
      ? (typeof body.timezone === 'string' ? body.timezone.trim() || 'UTC' : 'UTC')
      : undefined;

  const updated = db.updateRoutine(id, {
    name,
    schedule,
    timezone,
    enabled: body.enabled,
    inputs: body.inputs,
  });
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);

  // Sync scheduler (DST-aware via IANA timezone)
  addOrUpdateSchedule(updated.id, updated.schedule, updated.enabled, updated.timezone);

  return c.json({ ok: true, data: updated });
});

routines.delete('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const deleted = db.deleteRoutine(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  removeSchedule(id);
  return c.json({ ok: true });
});

routines.post('/:id/run', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const routine = db.getRoutine(id);
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);

  const runId = await runRoutine(id);
  if (!runId) {
    return c.json({ ok: false, error: 'Failed to execute routine' }, 500);
  }
  return c.json({ ok: true, data: { runId } });
});

routines.get('/:id/runs', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const routine = db.getRoutine(id);
  if (!routine) return c.json({ ok: false, error: 'Not found' }, 404);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '20') || 20, 1), 100);
  const runs = db.listRoutineRuns(id, limit);
  return c.json({ ok: true, data: runs });
});

/**
 * Crystallize a successful routine run into a reusable skill candidate (SKILL.md + DB row).
 * Body optional: { name?: string, description?: string }
 */
routines.post('/:id/runs/:runId/crystallize', async (c) => {
  const routineId = c.req.param('id').trim();
  const runParam = c.req.param('runId').trim();
  if (!routineId || !runParam) {
    return c.json({ ok: false, error: !routineId ? 'Routine not found' : 'Routine run not found' }, 404);
  }
  const routine = db.getRoutine(routineId);
  if (!routine) return c.json({ ok: false, error: 'Routine not found' }, 404);

  const routineRun = db.getRoutineRun(routineId, runParam);
  if (!routineRun) return c.json({ ok: false, error: 'Routine run not found' }, 404);
  if (routineRun.status !== 'completed') {
    return c.json({ ok: false, error: 'Only completed runs can be crystallized' }, 400);
  }

  const body = await c.req.json<{ name?: string; description?: string }>().catch(() => ({} as { name?: string; description?: string }));
  const workflow = workflowDb.getWorkflow(routine.workflowId);
  const workflowRunId = routineRun.runId;
  const workflowRun = workflowRunId ? workflowDb.getRun(workflowRunId) : undefined;

  const rawName =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : routine.name;
  const slugBase = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'crystallized-skill';
  const skillName = `${slugBase}-${routineRun.id.slice(0, 8)}`;
  const description =
    (typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : undefined)
    ?? `Crystallized from routine "${routine.name}"` +
      (workflow ? ` / workflow "${workflow.name}"` : '');

  const outputsSummary = workflowRun
    ? Object.entries(workflowRun.nodeResults)
        .map(([nodeId, result]) => {
          const r = result as { status?: string; output?: unknown; error?: string };
          const out =
            r.output === undefined
              ? r.error ?? r.status ?? ''
              : typeof r.output === 'string'
                ? r.output
                : JSON.stringify(r.output, null, 2);
          return `### Node \`${nodeId}\`\n\n\`\`\`\n${String(out).slice(0, 4000)}\n\`\`\``;
        })
        .join('\n\n')
    : '_No workflow run outputs available._';

  const skillMd = `---
name: ${skillName}
description: ${description.replace(/\n/g, ' ')}
version: 0.1.0
source: crystallize
---

# ${skillName}

${description}

## Origin

- Routine: \`${routine.name}\` (\`${routine.id}\`)
- Routine run: \`${routineRun.id}\`
- Workflow: \`${routine.workflowId}\`
- Workflow run: \`${workflowRunId ?? 'n/a'}\`
- Crystallized at: ${new Date().toISOString()}

## Captured outputs

${outputsSummary}

## How to use

Review and edit this skill, then enable it under Skills. Use it as a prompt/reference for similar automated runs.
`;

  const skillsDir = path.join(os.homedir(), '.config', 'neos-work', 'skills', skillName);
  await fs.mkdir(skillsDir, { recursive: true });
  const skillPath = path.join(skillsDir, 'SKILL.md');
  await fs.writeFile(skillPath, skillMd, 'utf8');

  const skillId = crypto.randomUUID();
  const sqlite = getDb();
  sqlite.prepare(
    `INSERT INTO skill (id, name, description, source, path, version, manifest_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       source = excluded.source,
       path = excluded.path,
       version = excluded.version,
       manifest_json = excluded.manifest_json`,
  ).run(
    skillId,
    skillName,
    description,
    'crystallize',
    skillPath,
    '0.1.0',
    JSON.stringify({ mode: 'reference', category: 'crystallized', featured: false }),
  );
  const row = sqlite.prepare('SELECT id, name, description, path, source, version FROM skill WHERE name = ?').get(skillName) as {
    id: string;
    name: string;
    description: string | null;
    path: string;
    source: string;
    version: string | null;
  };

  return c.json({
    ok: true,
    data: {
      skillId: row.id,
      name: row.name,
      description: row.description,
      path: row.path,
      source: row.source,
      version: row.version,
    },
  }, 201);
});

export default routines;
