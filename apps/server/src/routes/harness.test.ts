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

    const controlName = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'bad\nname',
        systemPrompt: 'You',
        allowedTools: [],
      }),
    });
    expect(controlName.status).toBe(400);
    expect(((await controlName.json()) as { error: string }).error).toMatch(/Invalid name/i);

    // Leading control-char name must not strip to a valid name
    const leadingName = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `\n${NAME}`,
        systemPrompt: 'You',
        allowedTools: [],
      }),
    });
    expect(leadingName.status).toBe(400);

    const longName = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'n'.repeat(201),
        systemPrompt: 'You',
        allowedTools: [],
      }),
    });
    expect(longName.status).toBe(400);
    expect(((await longName.json()) as { error: string }).error).toMatch(/Invalid name/i);

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

  it('normalizes unknown domain to general and blank path id to 404', async () => {
    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        domain: '  MARKETING  ',
        systemPrompt: 'prompt',
        allowedTools: [],
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string; domain: string } };
    expect(created.data.domain).toBe('general');

    const put = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: '  Finance  ' }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { domain: string } };
    expect(updated.data.domain).toBe('finance');

    const blank = await harness.request('/%20');
    expect(blank.status).toBe(404);

    await harness.request(`/${created.data.id}`, { method: 'DELETE' });
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

  it('forbids PUT/DELETE on built-in harnesses', async () => {
    const list = await harness.request('/');
    const body = await list.json() as { data: Array<{ id: string; isBuiltIn?: boolean }> };
    const builtin = body.data.find((h) => h.isBuiltIn);
    expect(builtin).toBeTruthy();

    const put = await harness.request(`/${builtin!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'hacked' }),
    });
    expect(put.status).toBe(403);
    expect(((await put.json()) as { error: string }).error).toMatch(/built-in/i);

    const del = await harness.request(`/${builtin!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(403);
    expect(((await del.json()) as { error: string }).error).toMatch(/built-in|Cannot delete/i);
  });

  it('rejects blank systemPrompt on PUT and missing allowedTools array on create', async () => {
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

    const blankPrompt = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: '   ' }),
    });
    expect(blankPrompt.status).toBe(400);
    expect(((await blankPrompt.json()) as { error: string }).error).toMatch(/systemPrompt/i);

    const notArray = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_tools`,
        systemPrompt: 'p',
        allowedTools: 'read',
      }),
    });
    expect(notArray.status).toBe(400);
    expect(((await notArray.json()) as { error: string }).error).toMatch(/allowedTools/i);

    await harness.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('filters control-char and overlong allowedTools', async () => {
    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Cov Harness Tools ${process.pid}`,
        domain: 'general',
        description: 'd',
        systemPrompt: 'You are helpful.',
        allowedTools: ['read', `bad${'\n'}tool`, 'x'.repeat(120), 'write'],
      }),
    });
    expect(create.status).toBe(201);
    const body = await create.json() as { data: { id: string; allowedTools: string[] } };
    expect(body.data.allowedTools).toEqual(['read', 'write']);
    await harness.request(`/${body.data.id}`, { method: 'DELETE' });
  });

  it('returns 404 for control-char or overlong harness ids', async () => {
    const control = await harness.request(`/${encodeURIComponent('bad\nid')}`);
    expect(control.status).toBe(404);

    const overlong = await harness.request(`/${'h'.repeat(101)}`);
    expect(overlong.status).toBe(404);

    const put = await harness.request(`/${encodeURIComponent('x\0y')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n' }),
    });
    expect(put.status).toBe(404);

    const del = await harness.request(`/${'z'.repeat(101)}`, { method: 'DELETE' });
    expect(del.status).toBe(404);
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

  it('rejects null-byte description/systemPrompt on create and PUT', async () => {
    const nulDesc = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        description: `bad${'\0'}desc`,
        systemPrompt: 'prompt',
        allowedTools: [],
      }),
    });
    expect(nulDesc.status).toBe(400);
    expect(((await nulDesc.json()) as { error: string }).error).toMatch(/Invalid description/i);

    const nulPrompt = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        systemPrompt: `p${'\0'}x`,
        allowedTools: [],
      }),
    });
    expect(nulPrompt.status).toBe(400);
    expect(((await nulPrompt.json()) as { error: string }).error).toMatch(/systemPrompt|required/i);

    const create = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        description: 'ok',
        systemPrompt: 'prompt',
        allowedTools: [],
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string } };

    const putDesc = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: `x${'\0'}y` }),
    });
    expect(putDesc.status).toBe(400);
    expect(((await putDesc.json()) as { error: string }).error).toMatch(/Invalid description/i);

    const putPrompt = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: `sys${'\0'}` }),
    });
    expect(putPrompt.status).toBe(400);
    expect(((await putPrompt.json()) as { error: string }).error).toMatch(/systemPrompt/i);

    const putBlankName = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(putBlankName.status).toBe(400);
    expect(((await putBlankName.json()) as { error: string }).error).toMatch(/name/i);

    // Multi-line description accepted at route; DB collapses control chars to spaces
    const multi = await harness.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'line1\nline2' }),
    });
    expect(multi.status).toBe(200);
    expect(((await multi.json()) as { data: { description: string } }).data.description).toBe(
      'line1 line2',
    );

    await harness.request(`/${created.data.id}`, { method: 'DELETE' });
  });
});
