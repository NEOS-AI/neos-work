/**
 * Skills API — catalog search/preview/audit, remote install, scan, toggle, delete.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { discoverSkills, readSkillProvenance, resolveBundledSkillsDir } from '@neos-work/core';
import { safeError } from '../lib/errors.js';
import { getDb } from '../db/schema.js';
import * as db from '../db/sessions.js';
import { publicPathTail, safeRouteId } from '../lib/path-safety.js';
import { SsrfError } from '../lib/ssrf.js';
import {
  auditRemoteSkill,
  previewRemoteSkill,
  searchSkillCatalog,
  SkillsHttpError,
} from '../lib/skills-catalog.js';
import {
  installRemoteSkill,
  pruneMissingRemoteSkills,
  readSkillContent,
  updateRemoteSkill,
} from '../lib/skills-install.js';

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

function getSkillById(id: string): SkillRow | undefined {
  const trimmed = safeSkillLookupId(id);
  if (!trimmed) return undefined;
  return getDb().prepare('SELECT * FROM skill WHERE id = ?').get(trimmed) as SkillRow | undefined;
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

function skillsError(c: Context, err: unknown, ctx: string) {
  if (err instanceof SkillsHttpError) {
    const body: Record<string, unknown> = { ok: false, error: err.code, ...err.extra };
    switch (err.http) {
      case 400: return c.json(body, 400);
      case 403: return c.json(body, 403);
      case 404: return c.json(body, 404);
      case 409: return c.json(body, 409);
      case 422: return c.json(body, 422);
      case 429: return c.json(body, 429);
      case 502: return c.json(body, 502);
      default: return c.json(body, 500);
    }
  }
  if (err instanceof SsrfError) {
    return c.json({ ok: false, error: 'ssrf_blocked' }, 502);
  }
  return c.json({ ok: false, error: safeError(err, ctx) }, 500);
}

function remoteListFields(manifest: Record<string, unknown> | null): {
  remoteId?: string;
  remoteSource?: string;
  remoteHash?: string;
  skillsShUrl?: string;
  license?: string;
} {
  const extra: {
    remoteId?: string;
    remoteSource?: string;
    remoteHash?: string;
    skillsShUrl?: string;
    license?: string;
  } = {};
  if (typeof manifest?.['license'] === 'string' && !/[\0\r\n]/.test(manifest['license'])) {
    const license = manifest['license'].trim();
    if (license) extra.license = license.slice(0, 100);
  }
  const prov = manifest?.['provenance'];
  if (prov && typeof prov === 'object' && !Array.isArray(prov)) {
    const p = prov as Record<string, unknown>;
    if (typeof p.id === 'string' && !/[\0\r\n]/.test(p.id) && p.id.trim()) {
      extra.remoteId = p.id.trim().slice(0, 200);
      extra.skillsShUrl = `https://skills.sh/${extra.remoteId}`;
    }
    if (typeof p.source === 'string' && !/[\0\r\n]/.test(p.source) && p.source.trim()) {
      extra.remoteSource = p.source.trim().slice(0, 200);
    }
    if (typeof p.hash === 'string' && !/[\0\r\n]/.test(p.hash) && p.hash.trim()) {
      extra.remoteHash = p.hash.trim().slice(0, 64);
    }
  }
  return extra;
}

// Static catalog routes BEFORE /:id
skills.get('/catalog/search', async (c) => {
  try {
    const data = await searchSkillCatalog({
      q: c.req.query('q'),
      limit: c.req.query('limit'),
      owner: c.req.query('owner'),
    });
    return c.json({ ok: true, data });
  } catch (err) {
    return skillsError(c, err, 'skills-search');
  }
});

skills.get('/catalog/preview', async (c) => {
  try {
    const data = await previewRemoteSkill({
      id: c.req.query('id'),
      url: c.req.query('url'),
    });
    return c.json({ ok: true, data });
  } catch (err) {
    return skillsError(c, err, 'skills-preview');
  }
});

skills.get('/catalog/audit', async (c) => {
  try {
    const data = await auditRemoteSkill({ id: c.req.query('id') });
    return c.json({ ok: true, data });
  } catch (err) {
    return skillsError(c, err, 'skills-audit');
  }
});

skills.post('/install', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'confirm_required' }, 400);
  }
  try {
    const data = await installRemoteSkill(
      {
        id: body.id,
        source: body.source,
        slug: body.slug,
        url: body.url,
        ref: body.ref,
        scope: body.scope,
        confirm: body.confirm,
        includeInternal: body.includeInternal,
      },
      { upsert: upsertSkill },
    );
    return c.json({ ok: true, data });
  } catch (err) {
    return skillsError(c, err, 'skills-install');
  }
});

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
      // Redact absolute on-disk path (home / username leak)
      path: publicPathTail(r.path),
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
      ...remoteListFields(manifest),
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

    const keepRemoteNames = await pruneMissingRemoteSkills();

    for (const skill of discovered) {
      if (keepRemoteNames.has(skill.manifest.name.toLowerCase())) continue;
      const sidecar = skill.packageDir ? await readSkillProvenance(skill.packageDir) : null;
      const manifestPayload = {
        ...skill.manifest,
        featured: sidecar ? false : skill.manifest.featured,
        ...(sidecar ? { provenance: sidecar } : {}),
        packageDir: skill.packageDir,
        examples: skill.examples,
        assets: skill.assets,
        references: skill.references,
      };
      upsertSkill({
        name: skill.manifest.name,
        description: skill.manifest.description,
        source: sidecar ? 'remote' : skill.source,
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

skills.get('/:id/content', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'not_found' }, 404);
  const row = getSkillById(id);
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);
  try {
    const content = await readSkillContent(row.path);
    if (!content) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({
      ok: true,
      data: { id: row.id, name: row.name, body: content.body, truncated: content.truncated },
    });
  } catch {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
});

skills.post('/:id/update', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'not_found' }, 404);
  try {
    const data = await updateRemoteSkill(id, { upsert: upsertSkill });
    return c.json({ ok: true, data });
  } catch (err) {
    return skillsError(c, err, 'skills-update');
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

// DELETE /api/skills/:id — registry-only
skills.delete('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Skill not found' }, 404);
  const deleted = deleteSkillById(id);
  if (!deleted) return c.json({ ok: false, error: 'Skill not found' }, 404);
  return c.json({ ok: true, data: { filesRemoved: false } });
});

/** Exported for unit tests (scan path hygiene). */
export { skills, upsertSkill };
