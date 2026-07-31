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

describe('connection-test additional branches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects invalid JSON and empty target', async () => {
    const bad = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(bad.status).toBe(400);

    const empty = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: '' }),
    });
    expect(empty.status).toBe(400);

    const ctrl = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'openai\n' }),
    });
    expect(ctrl.status).toBe(400);
  });

  it('url target requires url', async () => {
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'url' }),
    });
    expect(res.status).toBe(400);
  });

  it('ollama allows private base and reports fetch result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
      }),
    );
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'ollama' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reachable: boolean; status: number } };
    expect(body.data.reachable).toBe(true);
    expect(body.data.status).toBe(200);
  });

  it('anthropic default endpoint mock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        headers: { get: () => null },
      }),
    );
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'anthropic' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: number; message: string } };
    expect(body.data.status).toBe(403);
    expect(body.data.message).toMatch(/auth required/i);
  });

  it('blocks redirect to private host for public url target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest' : null,
        },
      }),
    );
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'url', url: 'https://example.com/redirect' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { blocked?: boolean; reachable: boolean } };
    expect(body.data.blocked).toBe(true);
    expect(body.data.reachable).toBe(false);
  });

  it('reports network failure as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'openai' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reachable: boolean; blocked: boolean } };
    expect(body.data.reachable).toBe(false);
    expect(body.data.blocked).toBe(false);
  });

  it('reports AbortError as timed out', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const res = await connectionTest.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'openai' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { message: string } };
    expect(body.data.message).toBe('Timed out');
  });
});
