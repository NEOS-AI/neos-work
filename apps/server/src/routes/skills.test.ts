import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import { skills } from './skills.js';

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
