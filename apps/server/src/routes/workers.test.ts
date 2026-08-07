import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorker, unregisterWorker } from '@neos-work/workflow-engine';
import { deleteCustomWorker, listCustomWorkers } from '../db/workers.js';
import workers from './workers.js';
import harness from './harness.js';

const NAME = `_cov_worker_route_${process.pid}`;

afterEach(() => {
  for (const w of listCustomWorkers()) {
    if (w.name === NAME || w.name.startsWith(NAME)) {
      deleteCustomWorker(w.id);
      unregisterWorker(w.id);
    }
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
    // Runtime registry must drop the custom worker (not only SQLite)
    expect(resolveWorker(id)).toBeUndefined();
    const gone = await workers.request(`/${id}`);
    expect(gone.status).toBe(404);

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

describe('harness HTTP sunset (0.10.2)', () => {
  it('returns 410 Gone with Deprecation headers and Link to /api/workers', async () => {
    const res = await harness.request('/');
    expect(res.status).toBe(410);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toMatch(/\/api\/workers/);
    const body = (await res.json()) as { ok: boolean; data?: { successor?: string } };
    expect(body.ok).toBe(false);
    expect(body.data?.successor).toBe('/api/workers');
  });
});

describe('workers validation edge cases', () => {
  it('create accepts full constraint/tool/workspace normalization', async () => {
    const create = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_full`,
        domain: '  CODING  ',
        description: '  desc  ',
        systemPrompt: '  system  ',
        allowedTools: [' web_search ', '', 'bad\ntool', 42, 'ok'.repeat(60), 'x'],
        constraints: {
          maxSteps: 999,
          maxTokens: 2_000_000,
          timeoutMs: 9_999_999,
          maxSpawnedWorkers: 99,
        },
        permissionProfile: '  READ_ONLY  ',
        defaultMode: '  SOLO  ',
        workspace: { kind: 'run', subdir: '  nested/path  ' },
      }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as {
      data: {
        id: string;
        domain: string;
        permissionProfile?: string;
        constraints?: {
          maxSteps?: number;
          maxTokens?: number;
          timeoutMs?: number;
          maxSpawnedWorkers?: number;
        };
        workspace?: { kind: string; subdir?: string };
        allowedTools: string[];
      };
    };
    expect(body.data.domain).toBe('coding');
    expect(body.data.permissionProfile).toBe('read_only');
    expect(body.data.constraints?.maxSteps).toBe(200);
    expect(body.data.constraints?.maxTokens).toBe(1_000_000);
    expect(body.data.constraints?.timeoutMs).toBe(3_600_000);
    expect(body.data.constraints?.maxSpawnedWorkers).toBe(8);
    expect(body.data.workspace?.kind).toBe('run');
    expect(body.data.workspace?.subdir).toBe('nested/path');
    // control-char tools dropped; overlong dropped
    expect(body.data.allowedTools.every((t) => t.length <= 100 && !/[\0\r\n]/.test(t))).toBe(true);

    await workers.request(`/${body.data.id}`, { method: 'DELETE' });
  });

  it('create rejects missing allowedTools and overlong name', async () => {
    const noTools = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_notools`,
        systemPrompt: 'p',
      }),
    });
    expect(noTools.status).toBe(400);

    const longName = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'n'.repeat(201),
        systemPrompt: 'p',
        allowedTools: [],
      }),
    });
    expect(longName.status).toBe(400);

    const badDesc = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_baddesc`,
        systemPrompt: 'p',
        allowedTools: [],
        description: `x${'\0'}y`,
      }),
    });
    expect(badDesc.status).toBe(400);
  });

  it('unknown domain/profile/mode fall back to defaults', async () => {
    const create = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_defaults`,
        domain: 'not-a-domain',
        systemPrompt: 'p',
        allowedTools: ['web_search'],
        permissionProfile: 'nope',
        defaultMode: 'nope',
        workspace: { kind: 'isolated' },
        constraints: { maxSteps: -1, maxTokens: 'x' },
      }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as {
      data: {
        id: string;
        domain: string;
        permissionProfile?: string;
        defaultMode?: string;
        workspace?: { kind: string };
        constraints?: object;
      };
    };
    expect(body.data.domain).toBe('general');
    expect(body.data.permissionProfile).toBe('full');
    expect(body.data.defaultMode).toBe('solo');
    expect(body.data.workspace?.kind).toBe('isolated');
    await workers.request(`/${body.data.id}`, { method: 'DELETE' });
  });

  it('PUT updates description/domain/tools/constraints/workspace with validation', async () => {
    const create = await workers.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_put`,
        systemPrompt: 'prompt',
        allowedTools: ['web_search'],
      }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const badJson = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const blankName = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blankName.status).toBe(400);

    const longName = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n'.repeat(201) }),
    });
    expect(longName.status).toBe(400);

    const badPrompt = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: '  ' }),
    });
    expect(badPrompt.status).toBe(400);

    const ctrlDesc = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: `d${'\0'}` }),
    });
    expect(ctrlDesc.status).toBe(400);

    const badTools = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allowedTools: 'nope' }),
    });
    expect(badTools.status).toBe(400);

    const put = await workers.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_put2`,
        systemPrompt: 'new prompt',
        description: '  d  ',
        domain: 'finance',
        allowedTools: ['read_file', 'bad\n'],
        constraints: { maxSteps: 5, timeoutMs: 1000 },
        permissionProfile: 'execute',
        workspace: { kind: 'none' },
        defaultMode: 'coordinator',
      }),
    });
    expect(put.status).toBe(200);
    const updated = (await put.json()) as {
      data: {
        name: string;
        domain: string;
        description?: string;
        permissionProfile?: string;
        defaultMode?: string;
        workspace?: { kind: string };
        allowedTools: string[];
        constraints?: { maxSteps?: number };
      };
    };
    expect(updated.data.name).toBe(`${NAME}_put2`);
    expect(updated.data.domain).toBe('finance');
    expect(updated.data.description).toBe('d');
    expect(updated.data.permissionProfile).toBe('execute');
    expect(updated.data.defaultMode).toBe('coordinator');
    expect(updated.data.workspace?.kind).toBe('none');
    expect(updated.data.allowedTools).toContain('read_file');
    expect(updated.data.constraints?.maxSteps).toBe(5);

    const missing = await workers.request('/no-such-custom-worker', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(missing.status).toBe(404);

    const blankPut = await workers.request('/%20', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(blankPut.status).toBe(404);

    // GET built-in worker
    const builtin = await workers.request('/finance_analyst');
    expect(builtin.status).toBe(200);

    await workers.request(`/${id}`, { method: 'DELETE' });
  });

  it('filters domain query case-insensitively', async () => {
    const res = await workers.request('/?domain=%20FINANCE%20');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ domain: string }> };
    expect(body.data.every((w) => w.domain === 'finance')).toBe(true);
  });
});
