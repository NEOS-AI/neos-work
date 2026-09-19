/**
 * GET /api/auth/local — loopback-only daemon token for Host mode.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';

import { decideLocalAuth, isLocalAuthDisabled } from '../lib/local-auth.js';
import { getRuntimeAuthToken } from '../lib/runtime-context.js';

const localAuth = new Hono();

function remoteAddressOf(c: { env: unknown }): string | undefined {
  try {
    return getConnInfo(c as Parameters<typeof getConnInfo>[0]).remote.address;
  } catch {
    return undefined;
  }
}

localAuth.get('/', (c) => {
  const decision = decideLocalAuth({
    remoteAddress: remoteAddressOf(c),
    host: c.req.header('Host'),
    token: getRuntimeAuthToken(),
    disabled: isLocalAuthDisabled(),
  });
  if (decision.status !== 200) {
    return c.json({ ok: false, error: decision.error }, decision.status);
  }
  return c.json({ ok: true, data: { token: decision.token } });
});

export { localAuth };
