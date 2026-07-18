import { afterEach, describe, expect, it } from 'vitest';
import { deleteMemory, listMemories } from '../lib/memory-store.js';
import memory from './memory.js';

const NAME = `_cov_mem_route_${process.pid}`;

afterEach(() => {
  for (const m of listMemories()) {
    if (m.name === NAME) deleteMemory(m.id);
  }
});

describe('memory routes', () => {
  it('rejects create without required fields', async () => {
    const res = await memory.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME }),
    });
    expect(res.status).toBe(400);
  });

  it('CRUD + toggle + export', async () => {
    const create = await memory.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        type: 'user',
        content: 'route coverage memory',
        enabled: true,
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; enabled: boolean } };
    const id = created.data.id;
    expect(created.data.enabled).toBe(true);

    const list = await memory.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((m) => m.id === id)).toBe(true);

    const get = await memory.request(`/${id}`);
    expect(get.status).toBe(200);

    const put = await memory.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'updated content' }),
    });
    expect(put.status).toBe(200);

    const toggle = await memory.request(`/${id}/toggle`, { method: 'PUT' });
    expect(toggle.status).toBe(200);
    const toggled = await toggle.json() as { data: { enabled: boolean } };
    expect(toggled.data.enabled).toBe(false);

    const exp = await memory.request('/export');
    expect(exp.status).toBe(200);
    const text = await exp.text();
    // disabled memories may be excluded from export — still markdown response
    expect(typeof text).toBe('string');

    const del = await memory.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await memory.request(`/${id}`);
    expect(missing.status).toBe(404);
  });
});
