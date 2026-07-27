/**
 * Skills API — manage installed skills (scan, toggle, delete).
 */

import { Hono } from 'hono';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { discoverSkills, resolveBundledSkillsDir } from '@neos-work/core';
import { safeError } from '../lib/errors.js';
import { getDb } from '../db/schema.js';
import * as db from '../db/sessions.js';
import { safeRouteId } from '../lib/path-safety.js';

/** Monorepo `skills/` catalog (apps/server/src/routes → repo root). */
const REPO_SKILLS_CANDIDATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../skills',
);

const skills = new Hono();

function paramId(c: { req: { param: (k: string) => string } }): string {
  return safeRouteId(c.req.param('id'));
}

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string;
  version: string | null;
  enabled: number;
  manifest_json: string | null;
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
  manifestJson?: string;
}): SkillRow {
  // Control-char check before trim (trim strips leading/trailing \r\n)
  const nameRaw = typeof params.name === 'string' ? params.name : '';
  if (/[\0\r\n]/.test(nameRaw) || nameRaw.trim().length > 200) {
    throw new Error('invalid skill name');
  }
  const name = nameRaw.trim();
  if (!name) throw new Error('name is required');
  let description: string | null = null;
  if (typeof params.description === 'string') {
    // Multi-line OK; reject null bytes only
    if (/\0/.test(params.description)) {
      throw new Error('invalid skill description');
    }
    description = params.description.trim() || null;
  }
  if (description && description.length > 4_000) {
    description = description.slice(0, 4_000);
  }
  const sourceRaw =
    typeof params.source === 'string' ? params.source : String(params.source ?? '');
  if (/[\0\r\n]/.test(sourceRaw) || sourceRaw.trim().length > 200) {
    throw new Error('invalid skill source');
  }
  let source = sourceRaw.trim();
  if (!source) source = 'local';
  const pathRaw =
    typeof params.path === 'string' ? params.path : String(params.path ?? '');
  if (pathRaw && /[\0\r\n]/.test(pathRaw)) {
    throw new Error('invalid skill path');
  }
  const pathVal = pathRaw.trim();
  if (pathVal.length > 1_000) {
    throw new Error('invalid skill path');
  }
  let version: string | null = null;
  if (typeof params.version === 'string') {
    if (/[\0\r\n]/.test(params.version)) {
      throw new Error('invalid skill version');
    }
    version = params.version.trim() || null;
  }
  if (version && version.length > 64) version = version.slice(0, 64);
  let manifestJson =
    typeof params.manifestJson === 'string' ? params.manifestJson : (params.manifestJson ?? null);
  if (manifestJson && manifestJson.length > 256 * 1024) {
    manifestJson = JSON.stringify({ truncated: true });
  }
  const dbInst = getDb();
  const id = crypto.randomUUID();
  dbInst.prepare(
    `INSERT INTO skill (id, name, description, source, path, version, manifest_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       source = excluded.source,
       path = excluded.path,
       version = excluded.version,
       manifest_json = excluded.manifest_json`,
  ).run(id, name, description, source, pathVal, version, manifestJson);
  return dbInst.prepare('SELECT * FROM skill WHERE name = ?').get(name) as SkillRow;
}

/** Practical bound for skill lookup ids. */
const SKILL_LOOKUP_ID_MAX = 100;

function safeSkillLookupId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > SKILL_LOOKUP_ID_MAX) return '';
  return id;
}

function toggleSkill(id: string, enabled: boolean): boolean {
  const trimmed = safeSkillLookupId(id);
  if (!trimmed) return false;
  const result = getDb()
    .prepare('UPDATE skill SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, trimmed);
  return result.changes > 0;
}

function deleteSkillById(id: string): boolean {
  const trimmed = safeSkillLookupId(id);
  if (!trimmed) return false;
  const result = getDb().prepare('DELETE FROM skill WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

/** Last path segment only — never leak absolute host paths to the client. */
function packageDirLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim().replace(/\\/g, '/');
  if (!t) return undefined;
  const parts = t.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return last && last.length <= 200 ? last : undefined;
}

function sanitizeExampleCards(raw: unknown): Array<{
  id?: string;
  key?: string;
  title?: string;
  path?: string;
}> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<{ id?: string; key?: string; title?: string; path?: string }> = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const card: { id?: string; key?: string; title?: string; path?: string } = {};
    if (typeof o.id === 'string' && !/[\0\r\n]/.test(o.id)) {
      const id = o.id.trim().slice(0, 200);
      if (id) card.id = id;
    }
    if (typeof o.key === 'string' && !/[\0\r\n]/.test(o.key)) {
      const key = o.key.trim().slice(0, 120);
      if (key) card.key = key;
    }
    if (typeof o.title === 'string' && !/[\0\r\n]/.test(o.title)) {
      const title = o.title.trim().slice(0, 200);
      if (title) card.title = title;
    }
    // Examples may store absolute paths on disk — only surface basename for UI
    const pathLabel = packageDirLabel(o.path);
    if (pathLabel) card.path = pathLabel;
    if (card.id || card.key || card.path) out.push(card);
  }
  return out.length > 0 ? out : undefined;
}

// GET /api/skills — list installed skills
skills.get('/', (c) => {
  const rows = listSkillRows();
  const data = rows.map((r) => {
    let manifest: Record<string, unknown> | null = null;
    if (r.manifest_json) {
      try { manifest = JSON.parse(r.manifest_json) as Record<string, unknown>; } catch { /* ignore */ }
    }
    const examples = sanitizeExampleCards(manifest?.['examples']);
    const sanitizeNames = (raw: unknown): string[] | undefined => {
      if (!Array.isArray(raw)) return undefined;
      const out: string[] = [];
      for (const item of raw.slice(0, 100)) {
        if (typeof item !== 'string' || /[\0\r\n]/.test(item)) continue;
        const base = packageDirLabel(item) ?? item.trim().split(/[/\\]/).pop();
        if (base && base.length <= 200) out.push(base);
      }
      return out.length > 0 ? out : undefined;
    };
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      path: r.path,
      version: r.version,
      enabled: r.enabled === 1,
      installedAt: r.installed_at,
      mode: manifest?.['mode'] as string | undefined,
      category: manifest?.['category'] as string | undefined,
      featured: manifest?.['featured'] === true,
      triggers: manifest?.['triggers'] as string[] | undefined,
      examplePrompt: manifest?.['examplePrompt'] as string | undefined,
      packageDir: packageDirLabel(manifest?.['packageDir']),
      exampleCount: examples?.length
        ?? (Array.isArray(manifest?.['examples'])
          ? (manifest!['examples'] as unknown[]).length
          : undefined),
      examples,
      assets: sanitizeNames(manifest?.['assets']),
      references: sanitizeNames(manifest?.['references']),
    };
  });
  return c.json({ ok: true, data });
});

// POST /api/skills/scan — discover and sync skills from filesystem
skills.post('/scan', async (c) => {
  try {
    const workspaces = db.listWorkspaces();
    const defaultWs = workspaces[0];
    const workspacePath = defaultWs?.path ?? undefined;

    const bundledRoot =
      resolveBundledSkillsDir(REPO_SKILLS_CANDIDATE)
      ?? resolveBundledSkillsDir(null);

    const discovered = await discoverSkills(workspacePath, {
      bundledRoot,
      includeBundled: true,
      includeGlobal: true,
    });

    for (const skill of discovered) {
      // Persist package metadata alongside frontmatter for UI package view
      const manifestPayload = {
        ...skill.manifest,
        packageDir: skill.packageDir,
        examples: skill.examples,
        assets: skill.assets,
        references: skill.references,
      };
      upsertSkill({
        name: skill.manifest.name,
        description: skill.manifest.description,
        source: skill.source,
        path: skill.path,
        version: skill.manifest.version ?? skill.manifest.metadata?.version,
        manifestJson: JSON.stringify(manifestPayload),
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
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Skill not found' }, 404);
  const body = await c.req.json<{ enabled: boolean }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'Missing or invalid "enabled" field' }, 400);
  }
  const updated = toggleSkill(id, body.enabled);
  if (!updated) return c.json({ ok: false, error: 'Skill not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/skills/:id — remove a skill from the registry
skills.delete('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Skill not found' }, 404);
  const deleted = deleteSkillById(id);
  if (!deleted) return c.json({ ok: false, error: 'Skill not found' }, 404);
  return c.json({ ok: true });
});

/** Exported for unit tests (scan path hygiene). */
export { skills, upsertSkill };
