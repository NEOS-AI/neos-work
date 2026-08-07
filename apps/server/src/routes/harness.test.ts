import { describe, expect, it } from 'vitest';
import harness from './harness.js';

describe('harness routes (removed 0.10.2)', () => {
  it('GET / returns 410 Gone with workers successor', async () => {
    const res = await harness.request('/');
    expect(res.status).toBe(410);
    expect(res.headers.get('Link')).toMatch(/\/api\/workers/);
    expect(res.headers.get('Deprecation')).toBe('true');
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      data?: { successor?: string; removedIn?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/0\.10\.2|workers/i);
    expect(body.data?.successor).toBe('/api/workers');
    expect(body.data?.removedIn).toBe('0.10.2');
  });

  it('POST / and GET /:id return 410', async () => {
    const post = await harness.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', systemPrompt: 'y', allowedTools: [] }),
    });
    expect(post.status).toBe(410);

    const get = await harness.request('/some-id');
    expect(get.status).toBe(410);

    const put = await harness.request('/some-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(put.status).toBe(410);

    const del = await harness.request('/some-id', { method: 'DELETE' });
    expect(del.status).toBe(410);
  });

  it('harnesses plural mount shape matches (same router)', async () => {
    // Mounted at both /api/harness and /api/harnesses in index.ts
    const res = await harness.request('/finance-worker');
    expect(res.status).toBe(410);
    const body = (await res.json()) as { data?: { successor?: string } };
    expect(body.data?.successor).toBe('/api/workers');
  });
});
