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

  it('oauth/start trims fields and rejects non-http endpoints', async () => {
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
});
