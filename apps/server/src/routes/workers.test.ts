import { afterEach, describe, expect, it } from 'vitest';
import { deleteCustomWorker, listCustomWorkers } from '../db/workers.js';
import workers from './workers.js';
import harness from './harness.js';

const NAME = `_cov_worker_route_${process.pid}`;

afterEach(() => {
  for (const w of listCustomWorkers()) {
    if (w.name === NAME || w.name.startsWith(NAME)) deleteCustomWorker(w.id);
  }
});

describe('workers routes', () => {
  it('lists built-in workers including research pack', async () => {
    const res = await workers.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Array<{ id: string; domain: string }> };
    expect(body.ok).toBe(true);
    const ids = body.data.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining(['finance_analyst', 'research_web', 'general_coordinator']));
  });

  it('filters by domain query', async () => {
    const res = await workers.request('/?domain=research');
    const body = (await res.json()) as { ok: boolean; data: Array<{ domain: string }> };
    expect(body.ok).toBe(true);
    expect(body.data.every((w) => w.domain === 'research')).toBe(true);
  });

  it('creates, gets, updates, deletes custom worker; rejects built-in delete', async () => {
    const create = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        domain: 'research',
        description: 'custom',
        systemPrompt: 'You are a custom worker.',
        allowedTools: ['web_search'],
        permissionProfile: 'network',
        defaultMode: 'solo',
        workspace: { kind: 'run' },
        constraints: { maxSteps: 9, maxSpawnedWorkers: 3 },
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      ok: boolean;
      data: { id: string; domain: string; permissionProfile?: string; constraints?: { maxSteps?: number } };
    };
    expect(created.ok).toBe(true);
    expect(created.data.domain).toBe('research');
    expect(created.data.permissionProfile).toBe('network');
    expect(created.data.constraints?.maxSteps).toBe(9);
    const id = created.data.id;

    const get = await workers.request(`/${id}`);
    expect(get.status).toBe(200);

    const put = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${NAME}_upd`, defaultMode: 'coordinator' }),
    });
    expect(put.status).toBe(200);
    const updated = (await put.json()) as { data: { name: string; defaultMode?: string } };
    expect(updated.data.name).toBe(`${NAME}_upd`);
    expect(updated.data.defaultMode).toBe('coordinator');

    const delBuiltin = await workers.request('/finance_analyst', { method: 'DELETE' });
    expect(delBuiltin.status).toBe(403);

    const putBuiltin = await workers.request('/finance_analyst', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(putBuiltin.status).toBe(403);

    const del = await workers.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const missing = await workers.request('/no-such-worker-xyz');
    expect(missing.status).toBe(404);
  });

  it('rejects invalid create bodies and blank path ids', async () => {
    const badJson = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const blankName = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', systemPrompt: 'p' }),
    });
    expect(blankName.status).toBe(400);

    const ctrlName = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `bad${'\n'}n`, systemPrompt: 'p' }),
    });
    expect(ctrlName.status).toBe(400);

    const ctrlPrompt = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, systemPrompt: `p${'\0'}` }),
    });
    expect(ctrlPrompt.status).toBe(400);

    const blankGet = await workers.request('/%20');
    expect(blankGet.status).toBe(404);
    const blankDel = await workers.request('/%20', { method: 'DELETE' });
    expect(blankDel.status).toBe(404);
  });

  it('ignores control-char domain filter on list', async () => {
    const res = await workers.request(`/?domain=${encodeURIComponent('research\n')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    // control-char domain ignored → full list
    expect(body.data.length).toBeGreaterThan(4);
  });
});

describe('harness deprecation alias', () => {
  it('serves list with Deprecation headers and Link to /api/workers', async () => {
    const res = await harness.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toMatch(/\/api\/workers/);
  });
});
