import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { resolveUserSkillsDir, writeSkillProvenance } from '@neos-work/core';

import { getDb } from '../db/schema.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import { isAuthExemptPath } from '../lib/auth-paths.js';
import {
  FIND_SKILLS_GOLDEN_HASH,
  FIND_SKILLS_ID,
  FIND_SKILLS_SEARCH_HIT,
  FIND_SKILLS_SNAPSHOT,
} from '../lib/fixtures/find-skills-snapshot.js';
import {
  FRONTEND_DESIGN_ID,
  FRONTEND_DESIGN_SKILL_MD,
} from '../lib/fixtures/frontend-design-skill.js';
import { makeSkillZip, skillMd } from '../lib/fixtures/skill-zip.js';
import { resetSkillsCatalogState, setSkillsCatalogFetchImpl } from '../lib/skills-catalog.js';
import { skills, upsertSkill } from './skills.js';

const SKILL_NAME = `_cov_skill_route_${process.pid}`;

function insertSkill(name = SKILL_NAME): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO skill (id, name, description, source, path, version, enabled, manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      id,
      name,
      'coverage skill',
      'local',
      `/tmp/${name}/SKILL.md`,
      '0.0.1',
      JSON.stringify({ mode: 'reference', category: 'test', featured: true, triggers: ['cov'] }),
    );
  return id;
}

afterEach(() => {
  getDb().prepare('DELETE FROM skill WHERE name = ? OR name LIKE ?').run(SKILL_NAME, `${SKILL_NAME}%`);
});

describe('skills routes', () => {
  it('lists skills with manifest fields', async () => {
    insertSkill();
    const res = await skills.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: Array<{
        name: string;
        enabled: boolean;
        category?: string;
        featured?: boolean;
        path?: string;
      }>;
    };
    expect(body.ok).toBe(true);
    const found = body.data.find((s) => s.name === SKILL_NAME);
    expect(found).toBeTruthy();
    expect(found!.enabled).toBe(true);
    expect(found!.category).toBe('test');
    expect(found!.featured).toBe(true);
    // Absolute host paths must not leak (publicSkillPath redacts to tail segments)
    expect(found!.path).toBeTruthy();
    expect(found!.path).not.toMatch(/^\/tmp\//);
    expect(found!.path).toContain('SKILL.md');
  });

  it('rejects control-char path ids on toggle/delete', async () => {
    const toggle = await skills.request('/%0abad/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(404);
    const del = await skills.request('/%0abad', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('upsertSkill rejects control-char name/source/path/version before trim', () => {
    expect(() =>
      upsertSkill({
        name: `\n${SKILL_NAME}`,
        source: 'local',
        path: `/tmp/${SKILL_NAME}`,
      }),
    ).toThrow(/invalid skill name/i);

    expect(() =>
      upsertSkill({
        name: SKILL_NAME,
        source: 'local\nbad',
        path: `/tmp/${SKILL_NAME}`,
      }),
    ).toThrow(/invalid skill source/i);

    expect(() =>
      upsertSkill({
        name: SKILL_NAME,
        source: 'local',
        path: `/tmp/${SKILL_NAME}\n`,
      }),
    ).toThrow(/invalid skill path/i);

    expect(() =>
      upsertSkill({
        name: SKILL_NAME,
        source: 'local',
        path: `/tmp/${SKILL_NAME}`,
        version: '1.0\n0',
      }),
    ).toThrow(/invalid skill version/i);

    expect(() =>
      upsertSkill({
        name: SKILL_NAME,
        source: 'local',
        path: `/tmp/${SKILL_NAME}`,
        description: `ok${'\0'}bad`,
      }),
    ).toThrow(/invalid skill description/i);
  });

  it('toggles enabled and rejects bad body', async () => {
    const id = insertSkill();
    const bad = await skills.request(`/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(bad.status).toBe(400);

    const noBody = await skills.request(`/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(noBody.status).toBe(400);

    const off = await skills.request(`/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);

    const list = await skills.request('/');
    const body = await list.json() as { data: Array<{ id: string; enabled: boolean }> };
    expect(body.data.find((s) => s.id === id)?.enabled).toBe(false);

    const missing = await skills.request('/no-such-id/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(missing.status).toBe(404);

    // blank path id
    const blank = await skills.request('/%20/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(blank.status).toBe(404);

    // padded id still works
    const on = await skills.request(`/%20${id}%20/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(200);
  });

  it('deletes skill and 404s missing', async () => {
    const id = insertSkill();
    const del = await skills.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const again = await skills.request(`/${id}`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('returns 404 for blank path ids after trim', async () => {
    const toggle = await skills.request('/%20/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(toggle.status).toBe(404);

    const del = await skills.request('/%20%20', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('returns 404 for control-char or overlong path ids', async () => {
    const ctrlToggle = await skills.request(`/${encodeURIComponent('bad\nid')}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(ctrlToggle.status).toBe(404);

    const longId = 's'.repeat(201);
    const longDel = await skills.request(`/${longId}`, { method: 'DELETE' });
    expect(longDel.status).toBe(404);

    const ctrlDel = await skills.request(`/${encodeURIComponent('id\rbad')}`, {
      method: 'DELETE',
    });
    expect(ctrlDel.status).toBe(404);
  });

  it('scan returns scanned/total shape', async () => {
    const res = await skills.request('/scan', { method: 'POST' });
    // filesystem scan may succeed or fail depending on env; accept both structured outcomes
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as { ok: boolean; data: { scanned: number; total: number } };
      expect(body.ok).toBe(true);
      expect(typeof body.data.scanned).toBe('number');
      expect(typeof body.data.total).toBe('number');
    }
  });
});

describe('upsertSkill edge cases', () => {
  it('truncates long description and version; defaults blank source', () => {
    const row = upsertSkill({
      name: `${SKILL_NAME}_trunc`,
      description: 'd'.repeat(5_000),
      source: '   ',
      path: `/tmp/${SKILL_NAME}_trunc/SKILL.md`,
      version: 'v'.repeat(100),
      manifestJson: JSON.stringify({ mode: 'reference' }),
    });
    expect(row.name).toBe(`${SKILL_NAME}_trunc`);
    expect(row.description?.length).toBe(4_000);
    expect(row.source).toBe('local');
    expect(row.version?.length).toBe(64);
  });

  it('rejects blank name and overlong path', () => {
    expect(() =>
      upsertSkill({
        name: '   ',
        source: 'local',
        path: '/tmp/x',
      }),
    ).toThrow(/name is required|invalid skill name/i);

    expect(() =>
      upsertSkill({
        name: `${SKILL_NAME}_longpath`,
        source: 'local',
        path: 'p'.repeat(1_001),
      }),
    ).toThrow(/invalid skill path/i);

    expect(() =>
      upsertSkill({
        name: 'n'.repeat(201),
        source: 'local',
        path: '/tmp/x',
      }),
    ).toThrow(/invalid skill name/i);
  });

  it('truncates huge manifest_json', () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(300_000) });
    const row = upsertSkill({
      name: `${SKILL_NAME}_manifest`,
      source: 'local',
      path: `/tmp/${SKILL_NAME}_manifest`,
      manifestJson: huge,
    });
    expect(row.manifest_json).toMatch(/truncated/);
  });

  it('updates existing skill on name conflict', () => {
    const first = upsertSkill({
      name: `${SKILL_NAME}_upsert`,
      source: 'local',
      path: '/tmp/a',
      description: 'first',
    });
    const second = upsertSkill({
      name: `${SKILL_NAME}_upsert`,
      source: 'remote',
      path: '/tmp/b',
      description: 'second',
      version: '2.0.0',
    });
    expect(second.name).toBe(first.name);
    expect(second.description).toBe('second');
    expect(second.source).toBe('remote');
    expect(second.path).toBe('/tmp/b');
    expect(second.version).toBe('2.0.0');
  });

  it('list tolerates invalid manifest_json', async () => {
    const id = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO skill (id, name, description, source, path, version, enabled, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, `${SKILL_NAME}_badjson`, null, 'local', '/tmp/x', null, '{not-json');

    const res = await skills.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string; category?: string }> };
    const found = body.data.find((s) => s.name === `${SKILL_NAME}_badjson`);
    expect(found).toBeTruthy();
    expect(found!.category).toBeUndefined();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(href);
  }) as typeof fetch;
}

describe('skills catalog + snapshot install routes', () => {
  afterEach(async () => {
    resetSkillsCatalogState();
    try { deleteSetting('skills.remoteCatalogEnabled'); } catch { /* ignore */ }
    try { deleteSetting('skills.remoteInstallEnabled'); } catch { /* ignore */ }
    getDb().prepare("DELETE FROM skill WHERE name IN ('find-skills', 'code-review') OR name LIKE '_cat_route_%'").run();
    await rm(join(resolveUserSkillsDir(), 'find-skills'), { recursive: true, force: true }).catch(() => {});
    await rm(join(resolveUserSkillsDir(), 'code-review'), { recursive: true, force: true }).catch(() => {});
  });

  it('does not add catalog or install routes to isAuthExemptPath', () => {
    expect(isAuthExemptPath('/api/skills/catalog/search')).toBe(false);
    expect(isAuthExemptPath('/api/skills/catalog/preview')).toBe(false);
    expect(isAuthExemptPath('/api/skills/install')).toBe(false);
    expect(isAuthExemptPath('/api/skills/some-id/content')).toBe(false);
  });

  it('GET /catalog/search happy path, empty, short query, 401 and 404 → 502', async () => {
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('q=empty')) return jsonResponse({ query: 'empty', searchType: 'fuzzy', skills: [], count: 0 });
      if (url.includes('q=denied')) return jsonResponse({ error: 'authentication_required' }, 401);
      if (url.includes('q=missing')) return jsonResponse({ error: 'gone' }, 404);
      return jsonResponse({ query: 'find', searchType: 'fuzzy', skills: [FIND_SKILLS_SEARCH_HIT], count: 1 });
    }));

    const ok = await skills.request('/catalog/search?q=find&limit=5');
    expect(ok.status).toBe(200);
    const okBody = await ok.json() as { data: { count: number; skills: Array<{ slug: string }> } };
    expect(okBody.data.count).toBe(1);
    expect(okBody.data.skills[0]?.slug).toBe('find-skills');

    const empty = await skills.request('/catalog/search?q=empty');
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { data: { count: number } }).data.count).toBe(0);

    const short = await skills.request('/catalog/search?q=a');
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toBe('query_too_short');

    const denied = await skills.request('/catalog/search?q=denied');
    expect(denied.status).toBe(502);
    expect(((await denied.json()) as { error: string }).error).toBe('upstream_unavailable');

    const missing = await skills.request('/catalog/search?q=missing');
    expect(missing.status).toBe(502);
    expect(((await missing.json()) as { error: string }).error).toBe('upstream_unavailable');
  });

  it('GET /catalog/preview find-skills snapshot and frontend-design raw', async () => {
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('codeload.github.com')) throw new Error('preview must not zip');
      if (url.includes('/api/download/anthropics/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url.includes('raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md')) {
        return new Response(FRONTEND_DESIGN_SKILL_MD, { status: 200 });
      }
      if (url.includes('/api/download/')) return jsonResponse(FIND_SKILLS_SNAPSHOT);
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const ok = await skills.request(`/catalog/preview?id=${encodeURIComponent(FIND_SKILLS_ID)}`);
    expect(ok.status).toBe(200);
    const body = await ok.json() as { data: { fetchPath?: string; hash: string; trust: string } };
    expect(body.data.fetchPath).toBe('snapshot');
    expect(body.data.hash).toBe(FIND_SKILLS_GOLDEN_HASH);
    expect(body.data.trust).toBe('unverified');

    const raw = await skills.request(`/catalog/preview?id=${encodeURIComponent(FRONTEND_DESIGN_ID)}`);
    expect(raw.status).toBe(200);
    const rawBody = await raw.json() as { data: { fetchPath?: string; name: string } };
    expect(rawBody.data.fetchPath).toBe('direct');
    expect(rawBody.data.name).toBe('frontend-design');
  });

  it('POST /install snapshot, hash mismatch still installs, zipball fallback, confirm 400', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
      ...FIND_SKILLS_SNAPSHOT,
      hash: 'bb'.repeat(32),
    })));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    expect(installed.status).toBe(200);
    const instBody = await installed.json() as { data: { name: string; hash: string; fetchPath: string } };
    expect(instBody.data.name).toBe('find-skills');
    expect(instBody.data.hash).toBe('bb'.repeat(32));
    expect(instBody.data.fetchPath).toBe('snapshot');

    const root = resolveUserSkillsDir();
    expect(root).not.toBe(join(homedir(), '.config', 'neos-work', 'skills'));
    const md = await readFile(join(root, 'find-skills', 'SKILL.md'), 'utf8');
    expect(md).toContain('name: find-skills');

    const noConfirm = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID }),
    });
    expect(noConfirm.status).toBe(400);
    expect(((await noConfirm.json()) as { error: string }).error).toBe('confirm_required');

    resetSkillsCatalogState();
    const zip = await makeSkillZip([
      { name: 'repo/skills/find-skills/SKILL.md', content: FIND_SKILLS_SNAPSHOT.files[0]!.contents },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('/api/download/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url.includes('codeload.github.com')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const noSnap = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/vercel-labs/skills', slug: 'find-skills', confirm: true }),
    });
    expect(noSnap.status).toBe(200);
    expect(((await noSnap.json()) as { data: { fetchPath: string } }).data.fetchPath).toBe('zipball');
  });

  it('catalog flag false blocks search but not install; install flag blocks install', async () => {
    setSetting('skills.remoteCatalogEnabled', 'false');
    const search = await skills.request('/catalog/search?q=find');
    expect(search.status).toBe(403);
    expect(((await search.json()) as { error: string }).error).toBe('catalog_disabled');

    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    expect(installed.status).toBe(200);

    setSetting('skills.remoteInstallEnabled', 'false');
    const blocked = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: string }).error).toBe('install_disabled');
  });

  it('plugin-only dest dir returns 409 occupied_plugin', async () => {
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'open-design.json'), '{"schemaVersion":"od-plugin/v1"}', 'utf8');
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const res = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('occupied_plugin');
  });

  it('DELETE remote+sidecar+inside removes files', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    const instBody = await installed.json() as { data: { id: string } };
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    const del = await skills.request(`/${instBody.data.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const delBody = await del.json() as { data?: { filesRemoved?: boolean; restored?: string } };
    expect(delBody.data?.filesRemoved).toBe(true);
    expect(delBody.data?.restored).toBeUndefined();
    await expect(readFile(join(dest, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const list = await skills.request('/');
    const body = await list.json() as { data: Array<{ name: string }> };
    expect(body.data.find((s) => s.name === 'find-skills')).toBeUndefined();
  });

  it('DELETE remote without sidecar is registry-only', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    const instBody = await installed.json() as { data: { id: string } };
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await rm(join(dest, 'neos-skill-source.json'), { force: true });
    const del = await skills.request(`/${instBody.data.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const delBody = await del.json() as { data?: { filesRemoved?: boolean } };
    expect(delBody.data?.filesRemoved).toBe(false);
    const md = await readFile(join(dest, 'SKILL.md'), 'utf8');
    expect(md).toContain('name: find-skills');
    const list = await skills.request('/');
    const body = await list.json() as { data: Array<{ name: string }> };
    expect(body.data.find((s) => s.name === 'find-skills')).toBeUndefined();
  });

  it('DELETE remote that shadowed bundled restores the bundled row', async () => {
    const root = resolveUserSkillsDir();
    const dest = join(root, 'code-review');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'SKILL.md'), skillMd('code-review'), 'utf8');
    await writeSkillProvenance(dest, {
      schemaVersion: 'neos-skill-source/v1',
      origin: 'github',
      id: 'acme/tmp/code-review',
      source: 'acme/tmp',
      slug: 'code-review',
      trust: 'unverified',
      installedAt: new Date().toISOString(),
    });
    upsertSkill({
      name: 'code-review',
      description: 'remote copy',
      source: 'remote',
      path: join(dest, 'SKILL.md'),
      manifestJson: JSON.stringify({ featured: false }),
    });
    const row = getDb().prepare("SELECT id FROM skill WHERE name = 'code-review'").get() as { id: string };
    const del = await skills.request(`/${row.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const delBody = await del.json() as { data?: { filesRemoved?: boolean; restored?: string } };
    expect(delBody.data?.filesRemoved).toBe(true);
    expect(delBody.data?.restored).toBe('bundled');
    await expect(readFile(join(dest, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const list = await skills.request('/');
    const body = await list.json() as { data: Array<{ name: string; source: string; id: string }> };
    const found = body.data.find((s) => s.name === 'code-review');
    expect(found).toBeTruthy();
    expect(found!.source).toBe('bundled');
    expect(found!.id).toBe(row.id);
  });

  it('GET /:id/content reads SKILL.md and 404s without leaking paths', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    const id = ((await installed.json()) as { data: { id: string } }).data.id;
    const res = await skills.request(`/${id}/content`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { body: string } };
    expect(body.data.body).toContain('name: find-skills');
    expect(JSON.stringify(body)).not.toContain(homedir());

    const missing = await skills.request(`/${crypto.randomUUID()}/content`);
    expect(missing.status).toBe(404);
    const missText = await missing.text();
    expect(missText).not.toContain(homedir());
    expect(missText).not.toContain('/.config/neos-work');
  });

  it('POST /:id/update returns not_remote for local skills', async () => {
    const id = insertSkill(`${SKILL_NAME}_localupd`);
    const res = await skills.request(`/${id}/update`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('not_remote');
  });

  it('scan keeps remote provenance and forces featured false', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
      files: [{
        path: 'SKILL.md',
        contents: `---
name: find-skills
description: fixture
featured: true
---
# Find
`,
      }],
      hash: FIND_SKILLS_GOLDEN_HASH,
    })));
    const installed = await skills.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: FIND_SKILLS_ID, confirm: true }),
    });
    expect(installed.status).toBe(200);
    const dest = join(resolveUserSkillsDir(), 'find-skills', 'SKILL.md');
    await writeFile(dest, `---
name: find-skills
description: after disk edit
featured: true
---
# Edited
`, 'utf8');

    const scan = await skills.request('/scan', { method: 'POST' });
    expect(scan.status).toBe(200);

    const list = await skills.request('/');
    const body = await list.json() as {
      data: Array<{
        name: string;
        featured?: boolean;
        remoteId?: string;
        remoteHash?: string;
        source: string;
      }>;
    };
    const found = body.data.find((s) => s.name === 'find-skills');
    expect(found).toBeTruthy();
    expect(found!.source).toBe('remote');
    expect(found!.featured).toBe(false);
    expect(found!.remoteId).toBe(FIND_SKILLS_ID);
    expect(found!.remoteHash).toBe(FIND_SKILLS_GOLDEN_HASH);
  });

  it('scan prunes a missing remote package and restores bundled of the same name', async () => {
    const root = resolveUserSkillsDir();
    const dest = join(root, 'code-review');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'SKILL.md'), skillMd('code-review'), 'utf8');
    await writeSkillProvenance(dest, {
      schemaVersion: 'neos-skill-source/v1',
      origin: 'github',
      id: 'acme/tmp/code-review',
      source: 'acme/tmp',
      slug: 'code-review',
      trust: 'unverified',
      installedAt: new Date().toISOString(),
    });
    upsertSkill({
      name: 'code-review',
      description: 'remote copy',
      source: 'remote',
      path: join(dest, 'SKILL.md'),
      manifestJson: JSON.stringify({ featured: false }),
    });
    await rm(join(dest, 'SKILL.md'), { force: true });

    const scan = await skills.request('/scan', { method: 'POST' });
    expect(scan.status).toBe(200);
    const list = await skills.request('/');
    const body = await list.json() as { data: Array<{ name: string; source: string }> };
    const found = body.data.find((s) => s.name === 'code-review');
    expect(found).toBeTruthy();
    expect(found!.source).toBe('bundled');
  });

  it('scan does not prune a remote row whose path is outside the current root', async () => {
    const id = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO skill (id, name, description, source, path, version, enabled, manifest_json)
         VALUES (?, ?, ?, 'remote', ?, NULL, 1, NULL)`,
      )
      .run(id, '_cat_route_stale_remote', 'stale', '/tmp/not-this-data-dir/SKILL.md');
    const scan = await skills.request('/scan', { method: 'POST' });
    expect(scan.status).toBe(200);
    const row = getDb().prepare('SELECT id, source FROM skill WHERE id = ?').get(id) as
      | { id: string; source: string }
      | undefined;
    expect(row?.source).toBe('remote');
  });
});
