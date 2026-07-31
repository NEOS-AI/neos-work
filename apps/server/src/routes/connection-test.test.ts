import { describe, expect, it, vi, afterEach } from 'vitest';
import connectionTest from './connection-test.js';

describe('connection-test routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cli-agents returns catalog count without network', async () => {
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'cli-agents' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { catalogCount: number } };
    expect(body.ok).toBe(true);
    expect(body.data.catalogCount).toBeGreaterThanOrEqual(12);
  });

  it('blocks private URL targets', async () => {
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'url', url: 'http://127.0.0.1/admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { blocked: boolean; reachable: boolean } };
    expect(body.data.blocked).toBe(true);
    expect(body.data.reachable).toBe(false);
  });

  it('reports reachable on public mock fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: { get: () => null },
      }),
    );
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'openai' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { reachable: boolean; status: number } };
    expect(body.data.reachable).toBe(true);
    expect(body.data.status).toBe(401);
  });

  it('rejects invalid target', async () => {
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});
