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
    const badJson = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const bad = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME }),
    });
    expect(bad.status).toBe(400);

    const blank = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '   ',
        systemPrompt: '  You  ',
        allowedTools: [],
      }),
    });
    expect(blank.status).toBe(400);

    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `  ${NAME}  `,
        domain: '  coding  ',
        description: '  route test  ',
        systemPrompt: '  You are a test harness.  ',
        allowedTools: ['read'],
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as {
      ok: boolean;
      data: { id: string; name: string; domain: string; description: string; systemPrompt: string };
    };
    expect(created.data.name).toBe(NAME);
    expect(created.data.domain).toBe('coding');
    expect(created.data.description).toBe('route test');
    expect(created.data.systemPrompt).toBe('You are a test harness.');
    const id = created.data.id;
    const get = await harness.request(`/${id}`);
    expect(get.status).toBe(200);

    const putBlank = await harness.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(putBlank.status).toBe(400);

    const del = await harness.request(`/${id}`, { method: 'DELETE' });
    expect([200, 204]).toContain(del.status);
    // In-memory registry may still resolve the id until process restart; DB should be cleared
    expect(listCustomHarnesses().some((h) => h.id === id)).toBe(false);
  });

  it('GET unknown returns 404', async () => {
    const res = await harness.request('/no-such-harness-xyz');
    expect(res.status).toBe(404);
  });

  it('PUT invalid JSON returns 400', async () => {
    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        systemPrompt: 'prompt',
        allowedTools: [],
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string } };
    const bad = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(bad.status).toBe(400);
    await harness.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('clamps constraints.maxSteps and trims allowedTools', async () => {
    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        systemPrompt: 'prompt',
        allowedTools: ['  read  ', '  ', 'write'],
        constraints: { maxSteps: 999, maxTokens: 100, timeoutMs: 5000 },
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as {
      data: {
        id: string;
        allowedTools: string[];
        constraints?: { maxSteps?: number; maxTokens?: number; timeoutMs?: number };
      };
    };
    expect(created.data.allowedTools).toEqual(['read', 'write']);
    expect(created.data.constraints?.maxSteps).toBe(200);
    expect(created.data.constraints?.maxTokens).toBe(100);

    const put = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        constraints: { maxSteps: 50 },
        allowedTools: ['  grep  ', ''],
      }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as {
      data: { allowedTools: string[]; constraints?: { maxSteps?: number } };
    };
    expect(updated.data.allowedTools).toEqual(['grep']);
    expect(updated.data.constraints?.maxSteps).toBe(50);
  });
});
