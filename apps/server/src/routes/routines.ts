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
import * as cron from 'node-cron';
import * as db from '../db/routines.js';
import * as workflowDb from '../db/workflows.js';
import { getDb } from '../db/schema.js';
import { addOrUpdateSchedule, removeSchedule, runRoutine } from '../lib/routine-scheduler.js';
import { estimateNextCronRun } from '../lib/cron-next.js';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';

const routines = new Hono();

function paramId(c: { req: { param: (k: string) => string } }, key = 'id'): string {
  return safeRouteId(c.req.param(key));
}

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
  const id = paramId(c);
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
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const nameRaw = typeof body.name === 'string' ? body.name : '';
  const workflowIdRaw = typeof body.workflowId === 'string' ? body.workflowId : '';
  const scheduleRaw = typeof body.schedule === 'string' ? body.schedule : '';
  const timezoneRaw = typeof body.timezone === 'string' ? body.timezone : '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(nameRaw) || nameRaw.trim().length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (/[\0\r\n]/.test(workflowIdRaw) || workflowIdRaw.trim().length > 100) {
    return c.json({ ok: false, error: 'workflowId is required' }, 400);
  }
  if (/[\0\r\n]/.test(scheduleRaw) || scheduleRaw.trim().length > 200) {
    return c.json({ ok: false, error: 'Invalid cron schedule' }, 400);
  }
  if (timezoneRaw && (/[\0\r\n]/.test(timezoneRaw) || timezoneRaw.trim().length > 100)) {
    return c.json({ ok: false, error: 'Invalid timezone' }, 400);
  }
  const name = nameRaw.trim();
  const workflowId = workflowIdRaw.trim();
  const schedule = scheduleRaw.trim();
  const timezone = timezoneRaw.trim() || undefined;

  if (!name) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (!workflowId) {
    return c.json({ ok: false, error: 'workflowId is required' }, 400);
  }
  if (!schedule) {
    return c.json({ ok: false, error: 'schedule is required' }, 400);
  }
  if (!cron.validate(schedule)) {
    return c.json({ ok: false, error: 'Invalid cron schedule' }, 400);
  }

  // Validate workflow exists
  const wf = workflowDb.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Workflow not found' }, 404);

  try {
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
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to create routine');
    return c.json({ ok: false, error: msg }, 400);
  }
});

routines.put('/:id', async (c) => {
  const id = paramId(c);
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

  let name: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    name = body.name.trim();
    if (!name || name.length > 200) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
  }
  let schedule: string | undefined;
  if (body.schedule !== undefined) {
    if (typeof body.schedule !== 'string' || /[\0\r\n]/.test(body.schedule)) {
      return c.json({ ok: false, error: 'Invalid cron schedule' }, 400);
    }
    schedule = body.schedule.trim();
    if (!schedule) {
      return c.json({ ok: false, error: 'schedule is required' }, 400);
    }
    if (schedule.length > 200 || !cron.validate(schedule)) {
      return c.json({ ok: false, error: 'Invalid cron schedule' }, 400);
    }
  }
  let timezone: string | undefined;
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || /[\0\r\n]/.test(body.timezone)) {
      return c.json({ ok: false, error: 'Invalid timezone' }, 400);
    }
    timezone = body.timezone.trim() || 'UTC';
    if (timezone.length > 100) {
      return c.json({ ok: false, error: 'Invalid timezone' }, 400);
    }
  }

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
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const deleted = db.deleteRoutine(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  removeSchedule(id);
  return c.json({ ok: true });
});

routines.post('/:id/run', async (c) => {
  const id = paramId(c);
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
  const id = paramId(c);
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
  const routineId = paramId(c);
  const runParam = paramId(c, 'runId');
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

  // Control-char name → fall back to routine name (check before trim)
  let rawName = routine.name;
  if (typeof body.name === 'string') {
    if (/[\0\r\n]/.test(body.name)) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    const n = body.name.trim();
    if (n) rawName = n;
  }
  const slugBase = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'crystallized-skill';
  const skillName = `${slugBase}-${routineRun.id.slice(0, 8)}`;
  let description =
    `Crystallized from routine "${routine.name}"` +
    (workflow ? ` / workflow "${workflow.name}"` : '');
  if (typeof body.description === 'string') {
    // Multi-line OK; reject null bytes
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    const d = body.description.trim();
    if (d) description = d;
  }
  // Cap description / skill markdown size (plan Task 2 crystallize polish)
  if (description.length > 4_000) description = description.slice(0, 4_000);

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

  const skillsRoot = path.join(os.homedir(), '.config', 'neos-work', 'skills');
  const skillsDir = path.join(skillsRoot, skillName);
  // Refuse planted skill-dir symlink (mkdir/write would follow outside)
  try {
    const dst = await fs.lstat(skillsDir);
    if (dst.isSymbolicLink()) {
      return c.json({ ok: false, error: 'Skill path conflict' }, 409);
    }
  } catch {
    // ENOENT — create
  }
  await fs.mkdir(skillsDir, { recursive: true });
  const skillPath = path.join(skillsDir, 'SKILL.md');
  // Do not write SKILL.md through a planted symlink
  try {
    const st = await fs.lstat(skillPath);
    if (st.isSymbolicLink()) await fs.unlink(skillPath);
  } catch {
    // ENOENT — ok
  }
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
