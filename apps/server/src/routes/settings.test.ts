import { afterEach, describe, expect, it } from 'vitest';
import { deleteSetting } from '../db/settings.js';
import { settings } from './settings.js';

const KEY = `cov.settings.${process.pid}`;
const SENSITIVE = 'apiKey.anthropic';

afterEach(() => {
  try { deleteSetting(KEY); } catch { /* ignore */ }
  try { deleteSetting(SENSITIVE); } catch { /* ignore */ }
});

describe('settings routes', () => {
  it('PUT GET DELETE non-sensitive setting', async () => {
    const put = await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'hello-world' }),
    });
    expect(put.status).toBe(200);

    const get = await settings.request(`/${KEY}`);
    expect(get.status).toBe(200);
    const body = await get.json() as { data: { value: string } };
    expect(body.data.value).toBe('hello-world');

    const del = await settings.request(`/${KEY}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await settings.request(`/${KEY}`);
    expect(missing.status).toBe(404);
  });

  it('masks sensitive values on GET', async () => {
    const put = await settings.request(`/${SENSITIVE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'sk-ant-super-secret-key' }),
    });
    expect(put.status).toBe(200);
    const get = await settings.request(`/${SENSITIVE}`);
    const body = await get.json() as { data: { value: string } };
    expect(body.data.value).not.toBe('sk-ant-super-secret-key');
    expect(body.data.value).toMatch(/\.\.\.|^\*{4}/);
  });

  it('rejects invalid keys', async () => {
    const res = await settings.request('/bad key!', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});
