/**
 * Skills API — manage installed skills (scan, toggle, delete).
 */

import { Hono } from 'hono';

import { discoverSkills } from '@neos-work/core';
import { safeError } from '../lib/errors.js';
import { getDb } from '../db/schema.js';
import * as db from '../db/sessions.js';

const skills = new Hono();

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string;
  version: string | null;
  enabled: number;
  installed_at: string;
}

function listSkillRows(): SkillRow[] {
  return getDb()
    .prepare('SELECT * FROM skill ORDER BY name ASC')
    .all() as SkillRow[];
}

function upsertSkill(params: {
  name: string;
  description?: string;
  source: string;
  path: string;
  version?: string;
}): SkillRow {
  const dbInst = getDb();
  const id = crypto.randomUUID();
  dbInst.prepare(
    `INSERT INTO skill (id, name, description, source, path, version)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       source = excluded.source,
       path = excluded.path,
       version = excluded.version`,
  ).run(id, params.name, params.description ?? null, params.source, params.path, params.version ?? null);
  return dbInst.prepare('SELECT * FROM skill WHERE name = ?').get(params.name) as SkillRow;
}

function toggleSkill(id: string, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE skill SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

function deleteSkillById(id: string): boolean {
  const result = getDb().prepare('DELETE FROM skill WHERE id = ?').run(id);
  return result.changes > 0;
}

// GET /api/skills — list installed skills
skills.get('/', (c) => {
  const rows = listSkillRows();
  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    source: r.source,
    path: r.path,
    version: r.version,
    enabled: r.enabled === 1,
    installedAt: r.installed_at,
  }));
  return c.json({ ok: true, data });
});

// POST /api/skills/scan — discover and sync skills from filesystem
skills.post('/scan', async (c) => {
  try {
    const workspaces = db.listWorkspaces();
    const defaultWs = workspaces[0];
    const workspacePath = defaultWs?.path ?? undefined;

    const discovered = await discoverSkills(workspacePath);

    for (const skill of discovered) {
      upsertSkill({
        name: skill.manifest.name,
        description: skill.manifest.description,
        source: skill.source,
        path: skill.path,
        version: skill.manifest.metadata?.version,
      });
    }

    const rows = listSkillRows();
    return c.json({ ok: true, data: { scanned: discovered.length, total: rows.length } });
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'skills-scan') }, 500);
  }
});

// POST /api/skills/:id/toggle — enable or disable a skill
skills.post('/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ enabled: boolean }>();
  if (typeof body.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'Missing or invalid "enabled" field' }, 400);
  }
  const updated = toggleSkill(id, body.enabled);
  if (!updated) return c.json({ ok: false, error: 'Skill not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/skills/:id — remove a skill from the registry
skills.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteSkillById(id);
  if (!deleted) return c.json({ ok: false, error: 'Skill not found' }, 404);
  return c.json({ ok: true });
});

export { skills };
