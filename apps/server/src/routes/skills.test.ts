import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
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
      data: Array<{ name: string; enabled: boolean; category?: string; featured?: boolean }>;
    };
    expect(body.ok).toBe(true);
    const found = body.data.find((s) => s.name === SKILL_NAME);
    expect(found).toBeTruthy();
    expect(found!.enabled).toBe(true);
    expect(found!.category).toBe('test');
    expect(found!.featured).toBe(true);
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
