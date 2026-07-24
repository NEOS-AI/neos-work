import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import { mcp } from './mcp.js';

const NAME = `_cov_mcp_route_${process.pid}`;

afterEach(() => {
  getDb().prepare('DELETE FROM mcp_server WHERE name = ?').run(NAME);
});

describe('mcp routes', () => {
  it('lists servers', async () => {
    const res = await mcp.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('creates stdio server, toggles, deletes; validates body', async () => {
    const bad = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, transport: 'stdio' }),
    });
    expect(bad.status).toBe(400);

    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'fake-mcp'],
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; enabled: boolean } };
    const id = created.data.id;
    expect(created.data.enabled).toBe(true);

    const toggleBadJson = await mcp.request(`/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(toggleBadJson.status).toBe(400);

    const toggle = await mcp.request(`/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(200);

    const list = await mcp.request('/');
    const listBody = await list.json() as { data: Array<{ id: string; enabled: boolean }> };
    expect(listBody.data.find((s) => s.id === id)?.enabled).toBe(false);

    const del = await mcp.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const again = await mcp.request(`/${id}`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('creates http transport with url', async () => {
    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'http',
        url: 'https://example.com/mcp',
      }),
    });
    expect(create.status).toBe(201);
  });

  it('rejects create with invalid JSON body', async () => {
    const res = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for blank path ids on get/toggle/delete', async () => {
    const get = await mcp.request('/%20%20');
    expect(get.status).toBe(404);

    const toggle = await mcp.request('/%20/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(404);

    const del = await mcp.request('/%20', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('trims name/command/url and rejects whitespace or non-http url', async () => {
    const blankName = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', transport: 'stdio', command: 'npx' }),
    });
    expect(blankName.status).toBe(400);

    const blankCmd = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, transport: 'stdio', command: '  ' }),
    });
    expect(blankCmd.status).toBe(400);

    const badUrl = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, transport: 'http', url: 'file:///etc/passwd' }),
    });
    expect(badUrl.status).toBe(400);

    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `  ${NAME}  `,
        transport: 'http',
        url: '  https://example.com/mcp  ',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { name: string; url?: string } };
    expect(created.data.name).toBe(NAME);
    expect(created.data.url).toBe('https://example.com/mcp');
  });

  it('rejects invalid transport, overlong name, missing http url, and toggle type errors', async () => {
    const badTransport = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, transport: 'websocket', command: 'x' }),
    });
    expect(badTransport.status).toBe(400);
    expect(((await badTransport.json()) as { error: string }).error).toMatch(/transport/i);

    const longName = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n'.repeat(201), transport: 'stdio', command: 'npx' }),
    });
    expect(longName.status).toBe(400);

    const missingUrl = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, transport: 'http' }),
    });
    expect(missingUrl.status).toBe(400);
    expect(((await missingUrl.json()) as { error: string }).error).toMatch(/url/i);

    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: 'npx',
        args: ['  -y  ', '', '  pkg  ', 42 as unknown as string],
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; args: string[] | null } };
    expect(created.data.args).toEqual(['-y', 'pkg', '42']);

    const badEnabled = await mcp.request(`/${created.data.id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(badEnabled.status).toBe(400);

    const missingToggle = await mcp.request('/no-such-mcp/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(missingToggle.status).toBe(404);

    await mcp.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('oauth refresh validates http endpoint and trims fields', async () => {
    const missing = await mcp.request('/oauth/s1/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenEndpoint: '  ', clientId: 'cid' }),
    });
    expect(missing.status).toBe(400);

    const badUrl = await mcp.request('/oauth/s1/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokenEndpoint: 'ftp://auth.example/token',
        clientId: 'cid',
      }),
    });
    expect(badUrl.status).toBe(400);

    // No stored refresh token → 400 after validation
    const noTok = await mcp.request('/oauth/s1/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokenEndpoint: '  https://auth.example/token  ',
        clientId: '  cid  ',
      }),
    });
    expect(noTok.status).toBe(400);
    const body = await noTok.json() as { error: string };
    expect(body.error).toMatch(/refresh token/i);
  });

  it('oauth/start rejects invalid JSON body', async () => {
    const res = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('oauth/callback trims query and escapes HTML error', async () => {
    const missing = await mcp.request('/oauth/callback?code=%20%20&state=%20');
    expect(missing.status).toBe(400);
    const missingBody = await missing.text();
    expect(missingBody).toMatch(/Missing code or state/i);

    const err = await mcp.request(
      '/oauth/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    );
    expect(err.status).toBe(400);
    const html = await err.text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('oauth/start trims fields and rejects non-http endpoints', async () => {
    const badJson = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
    const badJsonBody = await badJson.json() as { error: string };
    expect(badJsonBody.error).toMatch(/Invalid JSON/i);

    const missing = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId: '  ' }),
    });
    expect(missing.status).toBe(400);

    const badEndpoint = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: 's1',
        authorizationEndpoint: 'ftp://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'cid',
        redirectUri: 'http://localhost:3000/cb',
      }),
    });
    expect(badEndpoint.status).toBe(400);

    const ok = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: '  s1  ',
        authorizationEndpoint: '  https://auth.example/oauth  ',
        tokenEndpoint: '  https://auth.example/token  ',
        clientId: '  cid  ',
        redirectUri: '  http://localhost:3000/cb  ',
        scope: '  read  ',
      }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { ok: boolean; data: { authUrl: string; state: string } };
    expect(body.ok).toBe(true);
    expect(body.data.authUrl).toContain('https://auth.example/oauth');
    expect(body.data.authUrl).toContain('client_id=cid');
    expect(body.data.authUrl).toContain('scope=read');
    expect(body.data.state).toBeTruthy();
  });

  it('accepts case-insensitive transport and trims name/args', async () => {
    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `  ${NAME}  `,
        transport: '  STDIO  ',
        command: '  npx  ',
        args: ['  -y  ', '  ', 'fake'],
      }),
    });
    expect(create.status).toBe(201);
    const body = await create.json() as { data: { name: string; transport: string; command: string; args: string[] } };
    expect(body.data.name).toBe(NAME);
    expect(body.data.transport).toBe('stdio');
    expect(body.data.command).toBe('npx');
    expect(body.data.args).toEqual(['-y', 'fake']);
  });
});
