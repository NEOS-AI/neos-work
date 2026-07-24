import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('PUT invalid JSON returns 400', async () => {
    const res = await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('PUT blank sensitive value deletes the setting', async () => {
    const put = await settings.request(`/${SENSITIVE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'sk-to-clear' }),
    });
    expect(put.status).toBe(200);

    const clear = await settings.request(`/${SENSITIVE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: '   ' }),
    });
    expect(clear.status).toBe(200);
    const body = await clear.json() as { data?: { deleted?: boolean } };
    expect(body.data?.deleted).toBe(true);

    const get = await settings.request(`/${SENSITIVE}`);
    expect(get.status).toBe(404);
  });

  it('verify-key rejects missing/whitespace key and unknown provider', async () => {
    const blank = await settings.request('/verify-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', key: '   ' }),
    });
    expect(blank.status).toBe(400);

    const missingProv = await settings.request('/verify-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-test' }),
    });
    expect(missingProv.status).toBe(400);
    expect(((await missingProv.json()) as { error: string }).error).toMatch(/Missing provider or key/i);

    const unknown = await settings.request('/verify-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: '  OpenAI  ', key: 'sk-test' }),
    });
    expect(unknown.status).toBe(400);
    const body = await unknown.json() as { error: string };
    expect(body.error).toMatch(/Unknown provider/i);
  });

  it('GET / lists settings with sensitive keys masked', async () => {
    await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'plain-value' }),
    });
    await settings.request(`/${SENSITIVE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'sk-ant-super-secret-key' }),
    });

    const res = await settings.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Record<string, string> };
    expect(body.ok).toBe(true);
    expect(body.data[KEY]).toBe('plain-value');
    expect(body.data[SENSITIVE]).toBeDefined();
    expect(body.data[SENSITIVE]).not.toBe('sk-ant-super-secret-key');
    expect(body.data[SENSITIVE]).toMatch(/\.\.\.|^\*{4}/);
  });

  it('verify-key returns valid:false when adapter rejects the key', async () => {
    // Anthropic validateApiKey hits the network — stub fetch to fail closed as false
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    );
    try {
      const res = await settings.request('/verify-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', key: 'sk-bad' }),
      });
      // Either structured valid:false (200) or validation failed (400) depending on adapter throw
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json() as { data: { valid: boolean } };
        expect(body.data.valid).toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PUT rejects missing value and oversized payload; DELETE missing is 404', async () => {
    const missingValue = await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingValue.status).toBe(400);
    expect(((await missingValue.json()) as { error: string }).error).toMatch(/value/i);

    const nonString = await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 123 }),
    });
    expect(nonString.status).toBe(400);
    expect(((await nonString.json()) as { error: string }).error).toMatch(/too large|invalid type/i);

    // 1MB + 1 exceeds limit
    const tooBig = await settings.request(`/${KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1_000_001) }),
    });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/too large/i);

    const blankKey = await settings.request('/%20', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    expect(blankKey.status).toBe(400);

    const delMissing = await settings.request('/no.such.setting.key.xyz', { method: 'DELETE' });
    expect(delMissing.status).toBe(404);

    // short sensitive values mask as ****
    await settings.request(`/${SENSITIVE}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'short' }),
    });
    const getShort = await settings.request(`/${SENSITIVE}`);
    expect(getShort.status).toBe(200);
    const shortBody = await getShort.json() as { data: { value: string } };
    expect(shortBody.data.value).toBe('****');
  });
});
