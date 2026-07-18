import { afterEach, describe, expect, it } from 'vitest';
import { deleteCustomHarness, listCustomHarnesses } from '../db/harnesses.js';
import harness from './harness.js';

const NAME = `_cov_harness_route_${process.pid}`;

afterEach(() => {
  for (const h of listCustomHarnesses()) {
    if (h.name === NAME) deleteCustomHarness(h.id);
  }
});

describe('harness routes', () => {
  it('lists built-in harnesses', async () => {
    const res = await harness.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Array<{ id: string; name: string }> };
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('creates, gets, deletes custom harness; rejects incomplete body', async () => {
    const bad = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME }),
    });
    expect(bad.status).toBe(400);

    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        domain: 'coding',
        description: 'route test',
        systemPrompt: 'You are a test harness.',
        allowedTools: ['read'],
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { ok: boolean; data: { id: string; name: string } };
    expect(created.data.name).toBe(NAME);
    const id = created.data.id;
    const get = await harness.request(`/${id}`);
    expect(get.status).toBe(200);
    const del = await harness.request(`/${id}`, { method: 'DELETE' });
    expect([200, 204]).toContain(del.status);
    // In-memory registry may still resolve the id until process restart; DB should be cleared
    expect(listCustomHarnesses().some((h) => h.id === id)).toBe(false);
  });

  it('GET unknown returns 404', async () => {
    const res = await harness.request('/no-such-harness-xyz');
    expect(res.status).toBe(404);
  });
});
