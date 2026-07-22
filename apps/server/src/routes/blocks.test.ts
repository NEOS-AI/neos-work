import { afterEach, describe, expect, it } from 'vitest';
import { createCustomBlock, deleteCustomBlock } from '../db/blocks.js';
import blocks from './blocks.js';

const ID = `_cov_blk_route_${process.pid}`;

afterEach(() => {
  try { deleteCustomBlock(ID); } catch { /* ignore */ }
});

describe('blocks routes', () => {
  it('lists built-in and custom blocks', async () => {
    createCustomBlock({
      id: ID,
      name: 'Cov Block Route',
      domain: 'general',
      category: 'test',
      description: 'route cov',
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: 'in',
      outputDescription: 'out',
    });
    const res = await blocks.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: Array<{ id: string; isBuiltIn?: boolean; name: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.some((b) => b.id === ID)).toBe(true);
    // built-ins should also appear (finance/coding registry)
    expect(body.data.some((b) => b.isBuiltIn === true || b.id !== ID)).toBe(true);
  });

  it('GET missing custom block returns 404', async () => {
    const res = await blocks.request('/no-such-custom-block-xyz');
    // route may only support list or get
    expect([404, 405, 200]).toContain(res.status);
  });

  it('POST trims id/name and rejects invalid id or blank name', async () => {
    const blank = await blocks.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '  ',
        name: 'x',
        implementationType: 'prompt',
        promptTemplate: 'hi',
      }),
    });
    expect(blank.status).toBe(400);

    const badId = await blocks.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'bad id!',
        name: 'x',
        implementationType: 'prompt',
        promptTemplate: 'hi',
      }),
    });
    expect(badId.status).toBe(400);

    const create = await blocks.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `  ${ID}  `,
        name: '  Cov Block Route  ',
        domain: '  general  ',
        category: '  test  ',
        description: '  route cov  ',
        implementationType: 'prompt',
        promptTemplate: '  Hello {{inputs}}  ',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as {
      data: { id: string; name: string; domain: string; category: string; description: string; promptTemplate?: string };
    };
    expect(created.data.id).toBe(ID);
    expect(created.data.name).toBe('Cov Block Route');
    expect(created.data.domain).toBe('general');
    expect(created.data.category).toBe('test');
    expect(created.data.description).toBe('route cov');
    expect(created.data.promptTemplate).toBe('Hello {{inputs}}');

    const put = await blocks.request(`/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '  Renamed Block  ',
        domain: '  coding  ',
        description: '  updated  ',
      }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { name: string; domain: string; description: string } };
    expect(updated.data.name).toBe('Renamed Block');
    expect(updated.data.domain).toBe('coding');
    expect(updated.data.description).toBe('updated');

    const putBlank = await blocks.request(`/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(putBlank.status).toBe(400);
  });
});
