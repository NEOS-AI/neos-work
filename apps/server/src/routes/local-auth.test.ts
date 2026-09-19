import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { setRuntimeContext } from '../lib/runtime-context.js';
import { localAuth } from './local-auth.js';

const app = new Hono();
app.route('/api/auth/local', localAuth);

function loopbackEnv(addr = '127.0.0.1') {
  return { incoming: { socket: { remoteAddress: addr } } };
}

describe('GET /api/auth/local', () => {
  const prev = process.env.NEOS_LOCAL_AUTH;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEOS_LOCAL_AUTH;
    else process.env.NEOS_LOCAL_AUTH = prev;
    setRuntimeContext({ authToken: 'a'.repeat(32), port: 57286 });
  });

  it('returns the daemon token for a loopback client', async () => {
    setRuntimeContext({ authToken: 'host-mode-token-value', port: 57286 });
    const res = await app.request(
      '/api/auth/local',
      { headers: { Host: '127.0.0.1:57286' } },
      loopbackEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: { token?: string } };
    expect(body).toEqual({ ok: true, data: { token: 'host-mode-token-value' } });
  });

  it('forbids a non-loopback remote address', async () => {
    setRuntimeContext({ authToken: 'host-mode-token-value', port: 57286 });
    const res = await app.request(
      '/api/auth/local',
      { headers: { Host: '127.0.0.1:57286' } },
      loopbackEnv('203.0.113.9'),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Forbidden');
  });

  it('forbids when no connection info is present (fail closed)', async () => {
    setRuntimeContext({ authToken: 'host-mode-token-value', port: 57286 });
    const res = await app.request('/api/auth/local', {
      headers: { Host: '127.0.0.1:57286' },
    });
    expect(res.status).toBe(403);
  });

  it('does not trust X-Forwarded-For', async () => {
    setRuntimeContext({ authToken: 'host-mode-token-value', port: 57286 });
    const res = await app.request(
      '/api/auth/local',
      {
        headers: {
          Host: '127.0.0.1:57286',
          'X-Forwarded-For': '127.0.0.1',
        },
      },
      loopbackEnv('203.0.113.9'),
    );
    expect(res.status).toBe(403);
  });
});
