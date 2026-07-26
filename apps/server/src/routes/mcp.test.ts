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

  it('rejects control-char name/command on create', async () => {
    const badName = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `bad\n${NAME}`,
        transport: 'stdio',
        command: 'npx',
      }),
    });
    expect(badName.status).toBe(400);

    // Leading control-char must not strip to a valid name
    const leadingName = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `\n${NAME}`,
        transport: 'stdio',
        command: 'npx',
      }),
    });
    expect(leadingName.status).toBe(400);

    const badCmd = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: 'npx\nrm -rf /',
      }),
    });
    expect(badCmd.status).toBe(400);

    // Leading control-char command
    const leadingCmd = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: '\nnpx',
      }),
    });
    expect(leadingCmd.status).toBe(400);

    // Control-char transport must not strip to stdio
    const badTransport = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: '\nstdio',
        command: 'npx',
      }),
    });
    expect(badTransport.status).toBe(400);

    const badUrl = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}-url`,
        transport: 'http',
        // Control char in the middle survives trim(); must be rejected
        url: 'https://example.com/mcp\npath',
      }),
    });
    expect(badUrl.status).toBe(400);
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

    const longCode = await mcp.request(
      `/oauth/callback?code=${'a'.repeat(5_000)}&state=ok`,
    );
    expect(longCode.status).toBe(400);
    expect(await longCode.text()).toMatch(/Invalid authorization code/i);

    const longState = await mcp.request(
      `/oauth/callback?code=abc&state=${'s'.repeat(600)}`,
    );
    expect(longState.status).toBe(400);
    expect(await longState.text()).toMatch(/Invalid state/i);

    const nullCode = await mcp.request(
      `/oauth/callback?code=${encodeURIComponent('ab\0c')}&state=ok`,
    );
    expect(nullCode.status).toBe(400);
    expect(await nullCode.text()).toMatch(/Invalid authorization code/i);

    // Leading control-char code/state must not strip to valid values
    const leadCode = await mcp.request(
      `/oauth/callback?code=${encodeURIComponent('\nabc')}&state=ok`,
    );
    expect(leadCode.status).toBe(400);

    const leadState = await mcp.request(
      `/oauth/callback?code=abc&state=${encodeURIComponent('\nok')}`,
    );
    expect(leadState.status).toBe(400);

    const nlError = await mcp.request(
      `/oauth/callback?error=${encodeURIComponent('access\ndenied')}`,
    );
    expect(nlError.status).toBe(400);
    const nlHtml = await nlError.text();
    // Error is escaped and control chars do not break HTML structure
    expect(nlHtml).toMatch(/access|denied|Invalid|error/i);
  });

  it('rejects overlong command and filters overlong args on create', async () => {
    const longCmd = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: 'c'.repeat(501),
      }),
    });
    expect(longCmd.status).toBe(400);
    expect(((await longCmd.json()) as { error: string }).error).toMatch(/command|max length/i);

    const create = await mcp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        transport: 'stdio',
        command: 'npx',
        args: ['ok', 'a'.repeat(501), `bad${'\n'}arg`, 'tail'],
      }),
    });
    expect(create.status).toBe(201);
    const body = await create.json() as { data: { id: string; args: string[] | null } };
    // Overlong and control-char args dropped
    expect(body.data.args).toEqual(['ok', 'tail']);
    await mcp.request(`/${body.data.id}`, { method: 'DELETE' });
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

    // Leading control-char fields must not strip to valid values
    const ctrl = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: '\ns1',
        authorizationEndpoint: 'https://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'cid',
        redirectUri: 'http://localhost:3000/cb',
      }),
    });
    expect(ctrl.status).toBe(400);

    const ctrlEndpoint = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: 's1',
        authorizationEndpoint: '\nhttps://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'cid',
        redirectUri: 'http://localhost:3000/cb',
      }),
    });
    expect(ctrlEndpoint.status).toBe(400);

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

    // scope > 1000 rejected explicitly
    const longScope = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: 's1',
        authorizationEndpoint: 'https://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'cid',
        redirectUri: 'http://localhost:3000/cb',
        scope: 's'.repeat(1_001),
      }),
    });
    expect(longScope.status).toBe(400);
    expect(((await longScope.json()) as { error: string }).error).toMatch(/scope too long/i);

    // overlong clientId treated as missing required field
    const longClient = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: 's1',
        authorizationEndpoint: 'https://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'c'.repeat(501),
        redirectUri: 'http://localhost:3000/cb',
      }),
    });
    expect(longClient.status).toBe(400);
    expect(((await longClient.json()) as { error: string }).error).toMatch(/required|clientId/i);

    // non-http redirectUri rejected
    const badRedirect = await mcp.request('/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serverId: 's1',
        authorizationEndpoint: 'https://auth.example/oauth',
        tokenEndpoint: 'https://auth.example/token',
        clientId: 'cid',
        redirectUri: 'file:///tmp/cb',
      }),
    });
    expect(badRedirect.status).toBe(400);
    expect(((await badRedirect.json()) as { error: string }).error).toMatch(/redirectUri|http/i);
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

  it('oauth status and delete validate serverId and revoke tokens', async () => {
    const blankStatus = await mcp.request('/oauth/%20/status');
    expect(blankStatus.status).toBe(400);
    expect(((await blankStatus.json()) as { error: string }).error).toMatch(/serverId/i);

    const blankDelete = await mcp.request('/oauth/%20', { method: 'DELETE' });
    expect(blankDelete.status).toBe(400);

    // Control-char serverId must not strip to a valid id
    const ctrlStatus = await mcp.request(`/oauth/${encodeURIComponent('\ns1')}/status`);
    expect(ctrlStatus.status).toBe(400);
    const ctrlDelete = await mcp.request(`/oauth/${encodeURIComponent('s1\n')}`, {
      method: 'DELETE',
    });
    expect(ctrlDelete.status).toBe(400);

    // Missing token → status ok with disconnected
    const status = await mcp.request('/oauth/no-token-yet/status');
    expect(status.status).toBe(200);
    const statusBody = await status.json() as {
      ok: boolean;
      data: { connected: boolean };
    };
    expect(statusBody.ok).toBe(true);
    expect(statusBody.data.connected).toBe(false);

    // DELETE is idempotent when no token is stored
    const del = await mcp.request('/oauth/no-token-yet', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe('mcp presets + TradingView CDP', () => {
  const PRESET_NAME = `_cov_tv_preset_${process.pid}`;

  afterEach(() => {
    getDb().prepare('DELETE FROM mcp_server WHERE name = ?').run(PRESET_NAME);
  });

  it('lists built-in presets including tradingview', async () => {
    const res = await mcp.request('/presets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; domain?: string; toolHints: string[] }>;
    };
    expect(body.ok).toBe(true);
    const tv = body.data.find((p) => p.id === 'tradingview');
    expect(tv).toBeDefined();
    expect(tv?.domain).toBe('finance');
    expect(tv?.toolHints).toEqual(expect.arrayContaining(['tv_health_check']));
  });

  it('from-preset validates installPath and creates tradingview stdio server', async () => {
    const missing = await mcp.request('/from-preset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetId: 'tradingview' }),
    });
    expect(missing.status).toBe(400);

    const unknown = await mcp.request('/from-preset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presetId: 'nope', installPath: '/tmp' }),
    });
    expect(unknown.status).toBe(404);

    // Create a temp fake package root with src/server.js
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-tv-mcp-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'server.js'), 'console.log("fake")\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fake"}\n');

    try {
      const create = await mcp.request('/from-preset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          presetId: 'tradingview',
          installPath: dir,
          name: PRESET_NAME,
        }),
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as {
        ok: boolean;
        data: { name: string; transport: string; command: string | null; args: string[] | null };
      };
      expect(created.ok).toBe(true);
      expect(created.data.name).toBe(PRESET_NAME);
      expect(created.data.transport).toBe('stdio');
      expect(created.data.command).toBe('node');
      expect(created.data.args?.[0]).toContain(path.join('src', 'server.js').replace(/\\/g, path.sep));
      // Or just check ends with server.js
      expect(created.data.args?.[0]?.endsWith('server.js')).toBe(true);

      const dup = await mcp.request('/from-preset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          presetId: 'tradingview',
          installPath: dir,
          name: PRESET_NAME,
        }),
      });
      expect(dup.status).toBe(409);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probes tradingview cdp-health without throwing', async () => {
    const res = await mcp.request('/tradingview/cdp-health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { cdpConnected: boolean; port: number };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.data.cdpConnected).toBe('boolean');
    expect(body.data.port).toBe(9222);
  });
});
