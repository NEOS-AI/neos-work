import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DESIGN_SYSTEMS_DIR, listDesignSystems, deleteDesignSystem } from '../lib/design-system-store.js';
import designSystems from './design-systems.js';

const NAME = `_cov_ds_route_${process.pid}`;

afterEach(async () => {
  const list = await listDesignSystems();
  for (const ds of list) {
    if (ds.name === NAME || ds.name.startsWith(NAME)) {
      await deleteDesignSystem(ds.id);
    }
  }
  await fs.rm(path.join(DESIGN_SYSTEMS_DIR, NAME), { recursive: true, force: true }).catch(() => {});
});

describe('design-systems routes', () => {
  it('rejects create without name', async () => {
    const res = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('trims name/description and rejects whitespace-only name', async () => {
    const blank = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blank.status).toBe(400);

    const create = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `  ${NAME}  `, description: '  spaced  ' }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; name: string; description?: string } };
    expect(created.data.name).toBe(NAME);
    expect(created.data.description).toBe('spaced');
    await designSystems.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('creates, gets, lists, updates content, deletes', async () => {
    const create = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, description: 'route test' }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { ok: boolean; data: { id: string; name: string } };
    expect(created.ok).toBe(true);
    expect(created.data.name).toBe(NAME);
    const id = created.data.id;

    const list = await designSystems.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((d) => d.id === id)).toBe(true);

    const get = await designSystems.request(`/${id}`);
    expect(get.status).toBe(200);

    const contentGet = await designSystems.request(`/${id}/content`);
    const contentBody = await contentGet.json() as { data: { content: string } };
    expect(contentBody.data.content.length).toBeGreaterThan(0);

    const putBlank = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   \n\t  ' }),
    });
    expect(putBlank.status).toBe(400);

    const put = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Brand\n\nUpdated via route test.\n' }),
    });
    expect(put.status).toBe(200);

    const contentAgain = await designSystems.request(`/${id}/content`);
    const againBody = await contentAgain.json() as { data: { content: string } };
    expect(againBody.data.content).toContain('Updated via route test');

    const del = await designSystems.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await designSystems.request(`/${id}`);
    expect(missing.status).toBe(404);
  });

  it('returns 404 for unknown content', async () => {
    const res = await designSystems.request('/no-such-ds/content');
    expect(res.status).toBe(404);
  });

  it('returns 404 for blank path ids after trim', async () => {
    const get = await designSystems.request('/%20%20');
    expect(get.status).toBe(404);
    const del = await designSystems.request('/%20', { method: 'DELETE' });
    expect(del.status).toBe(404);
    const content = await designSystems.request('/%20/content');
    expect(content.status).toBe(404);
    const put = await designSystems.request('/%20/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# x' }),
    });
    expect(put.status).toBe(404);
  });
});
