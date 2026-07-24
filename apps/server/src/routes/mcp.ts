/**
 * MCP servers API — manage MCP server configurations + OAuth 2.0 PKCE flow.
 */

import crypto from 'node:crypto';
import { Hono } from 'hono';

import { getDb } from '../db/schema.js';
import { isSafeHttpBaseUrl } from '../db/settings.js';
import { escapeHtml, safeError } from '../lib/errors.js';
import {
  saveToken,
  loadToken,
  deleteToken,
  getTokenStatus,
  type McpOAuthToken,
} from '../lib/mcp-oauth-store.js';

// ── In-memory state for pending OAuth flows ──────────────────────────────────
interface PendingFlow {
  serverId: string;
  codeVerifier: string;
  state: string;
  authUrl: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  createdAt: number;
}
const pendingFlows = new Map<string, PendingFlow>(); // state → flow

// Expire pending flows older than 10 minutes
function cleanExpiredFlows() {
  const threshold = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingFlows) {
    if (v.createdAt < threshold) pendingFlows.delete(k);
  }
}

// PKCE helpers (S256)
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

const mcp = new Hono();

export interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  enabled: number;
  created_at: string;
}

function listMcpServers(): McpServerRow[] {
  return getDb().prepare('SELECT * FROM mcp_server ORDER BY name ASC').all() as McpServerRow[];
}

function getMcpServer(id: string): McpServerRow | undefined {
  return getDb().prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as McpServerRow | undefined;
}

function createMcpServer(params: {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}): McpServerRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const argsStr = params.args ? JSON.stringify(params.args) : null;
  db.prepare(
    `INSERT INTO mcp_server (id, name, transport, command, args, url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, params.name, params.transport, params.command ?? null, argsStr, params.url ?? null);
  return getMcpServer(id)!;
}

function toggleMcpServer(id: string, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE mcp_server SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

function deleteMcpServer(id: string): boolean {
  const result = getDb().prepare('DELETE FROM mcp_server WHERE id = ?').run(id);
  return result.changes > 0;
}

function rowToResponse(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : null,
    url: row.url,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

// GET /api/mcp-servers
mcp.get('/', (c) => {
  const rows = listMcpServers();
  return c.json({ ok: true, data: rows.map(rowToResponse) });
});

// POST /api/mcp-servers
mcp.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      transport: 'stdio' | 'http';
      command?: string;
      args?: string[];
      url?: string;
    }>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200) {
      return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
    }
    if (!['stdio', 'http'].includes(body.transport)) {
      return c.json({ ok: false, error: 'transport must be "stdio" or "http"' }, 400);
    }
    const command =
      typeof body.command === 'string' ? body.command.trim() : body.command;
    const url = typeof body.url === 'string' ? body.url.trim() : body.url;
    const args = Array.isArray(body.args)
      ? body.args
          .map((a) => (typeof a === 'string' ? a.trim() : String(a ?? '').trim()))
          .filter((a) => a.length > 0)
      : body.args;
    if (body.transport === 'stdio' && !command) {
      return c.json({ ok: false, error: 'command is required for stdio transport' }, 400);
    }
    if (body.transport === 'http' && !url) {
      return c.json({ ok: false, error: 'url is required for http transport' }, 400);
    }
    if (body.transport === 'http' && url && !isSafeHttpBaseUrl(url)) {
      return c.json({ ok: false, error: 'url must be http(s)' }, 400);
    }

    const row = createMcpServer({
      name,
      transport: body.transport,
      command,
      args,
      url,
    });
    return c.json({ ok: true, data: rowToResponse(row) }, 201);
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'mcp-create') }, 500);
  }
});

// POST /api/mcp-servers/:id/toggle
mcp.post('/:id/toggle', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  const body = await c.req.json<{ enabled: boolean }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'Missing or invalid "enabled" field' }, 400);
  }
  const updated = toggleMcpServer(id, body.enabled);
  if (!updated) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/mcp-servers/:id
mcp.delete('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  const deleted = deleteMcpServer(id);
  if (!deleted) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  return c.json({ ok: true });
});

export { mcp };

// ── OAuth 2.0 PKCE routes ───────────────────────────────────────────────────

/**
 * POST /api/mcp/oauth/start
 * Begin OAuth 2.0 PKCE flow for a given MCP server.
 * Body: { serverId, authorizationEndpoint, tokenEndpoint, clientId, redirectUri, scope? }
 * Returns: { authUrl }
 */
mcp.post('/oauth/start', async (c) => {
  try {
    const body = await c.req.json<{
      serverId: string;
      authorizationEndpoint: string;
      tokenEndpoint: string;
      clientId: string;
      redirectUri: string;
      scope?: string;
    }>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const serverId = typeof body.serverId === 'string' ? body.serverId.trim() : '';
    const authorizationEndpoint =
      typeof body.authorizationEndpoint === 'string' ? body.authorizationEndpoint.trim() : '';
    const tokenEndpoint =
      typeof body.tokenEndpoint === 'string' ? body.tokenEndpoint.trim() : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri.trim() : '';
    const scope = typeof body.scope === 'string' ? body.scope.trim() || undefined : undefined;

    if (!serverId || !authorizationEndpoint || !tokenEndpoint || !clientId || !redirectUri) {
      return c.json({ ok: false, error: 'Missing required fields' }, 400);
    }
    if (!isSafeHttpBaseUrl(authorizationEndpoint) || !isSafeHttpBaseUrl(tokenEndpoint)) {
      return c.json({ ok: false, error: 'authorizationEndpoint and tokenEndpoint must be http(s)' }, 400);
    }
    if (!isSafeHttpBaseUrl(redirectUri)) {
      return c.json({ ok: false, error: 'redirectUri must be http(s)' }, 400);
    }

    cleanExpiredFlows();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (scope) authUrl.searchParams.set('scope', scope);

    pendingFlows.set(state, {
      serverId,
      codeVerifier,
      state,
      authUrl: authUrl.toString(),
      redirectUri,
      tokenUrl: tokenEndpoint,
      clientId,
      createdAt: Date.now(),
    });

    return c.json({ ok: true, data: { authUrl: authUrl.toString(), state } });
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'mcp-oauth-start') }, 500);
  }
});

/**
 * GET /api/mcp/oauth/callback?code=...&state=...
 * Receives the authorization code from the OAuth provider.
 * Exchanges it for tokens and stores them.
 */
mcp.get('/oauth/callback', async (c) => {
  const code = (c.req.query('code') ?? '').trim();
  const state = (c.req.query('state') ?? '').trim();
  const error = (c.req.query('error') ?? '').trim();

  if (error) {
    return c.html(
      `<html><body><h2>OAuth Error</h2><p>${escapeHtml(error)}</p><script>window.close();</script></body></html>`,
      400,
    );
  }

  if (!code || !state) {
    return c.html('<html><body><h2>Missing code or state</h2></body></html>', 400);
  }

  const flow = pendingFlows.get(state);
  if (!flow) {
    return c.html('<html><body><h2>Invalid or expired state</h2></body></html>', 400);
  }

  // Constant-time state comparison (already matched by Map key — secondary guard)
  const stateBuffer = Buffer.from(state);
  const flowStateBuffer = Buffer.from(flow.state);
  if (
    stateBuffer.length !== flowStateBuffer.length ||
    !crypto.timingSafeEqual(stateBuffer, flowStateBuffer)
  ) {
    return c.html('<html><body><h2>State mismatch</h2></body></html>', 400);
  }

  pendingFlows.delete(state);

  try {
    // Token exchange
    let tokenRes: Response;
    try {
      tokenRes = await fetch(flow.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: flow.redirectUri,
          client_id: flow.clientId,
          code_verifier: flow.codeVerifier,
        }).toString(),
      });
    } catch {
      return c.html(
        '<html><body><h2>Token exchange failed</h2><p>Network error contacting token endpoint</p></body></html>',
        502,
      );
    }

    if (!tokenRes.ok) {
      const msg = await tokenRes.text().catch(() => '');
      return c.html(
        `<html><body><h2>Token exchange failed</h2><pre>${escapeHtml(msg.slice(0, 2000))}</pre></body></html>`,
        500,
      );
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    if (typeof tokenData.access_token !== 'string' || !tokenData.access_token.trim()) {
      return c.html(
        '<html><body><h2>Token exchange failed</h2><p>Missing access_token in response</p></body></html>',
        500,
      );
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    const token: McpOAuthToken = {
      serverId: flow.serverId,
      accessToken: tokenData.access_token.trim(),
      refreshToken:
        typeof tokenData.refresh_token === 'string'
          ? tokenData.refresh_token.trim() || undefined
          : tokenData.refresh_token,
      expiresAt,
      scope: typeof tokenData.scope === 'string' ? tokenData.scope.trim() || undefined : tokenData.scope,
      tokenType:
        typeof tokenData.token_type === 'string'
          ? tokenData.token_type.trim() || undefined
          : tokenData.token_type,
    };

    await saveToken(token);

    return c.html(
      `<html><body><h2>Connected successfully</h2><p>You can close this window.</p><script>window.close();</script></body></html>`,
    );
  } catch (err) {
    return c.html(
      `<html><body><h2>Error</h2><p>${escapeHtml(safeError(err, 'token-exchange'))}</p></body></html>`,
      500,
    );
  }
});

/**
 * GET /api/mcp/oauth/:serverId/status
 * Returns connection status for a given MCP server.
 */
mcp.get('/oauth/:serverId/status', async (c) => {
  const serverId = c.req.param('serverId').trim();
  if (!serverId) return c.json({ ok: false, error: 'serverId required' }, 400);
  const status = await getTokenStatus(serverId);
  return c.json({ ok: true, data: status });
});

/**
 * POST /api/mcp/oauth/:serverId/refresh
 * Refresh an access token using the stored refresh token.
 * Body: { tokenEndpoint, clientId }
 */
mcp.post('/oauth/:serverId/refresh', async (c) => {
  const serverId = c.req.param('serverId').trim();
  if (!serverId) return c.json({ ok: false, error: 'serverId required' }, 400);
  try {
    const body = await c.req.json<{ tokenEndpoint: string; clientId: string }>().catch(() => null);
    const tokenEndpoint =
      typeof body?.tokenEndpoint === 'string' ? body.tokenEndpoint.trim() : '';
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : '';
    if (!tokenEndpoint || !clientId) {
      return c.json({ ok: false, error: 'tokenEndpoint and clientId required' }, 400);
    }
    if (!isSafeHttpBaseUrl(tokenEndpoint)) {
      return c.json({ ok: false, error: 'tokenEndpoint must be http(s)' }, 400);
    }

    const existing = await loadToken(serverId);
    if (!existing?.refreshToken) {
      return c.json({ ok: false, error: 'No refresh token available' }, 400);
    }

    let tokenRes: Response;
    try {
      tokenRes = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: existing.refreshToken,
          client_id: clientId,
        }).toString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Token refresh network error';
      return c.json({ ok: false, error: msg }, 502);
    }

    if (!tokenRes.ok) {
      return c.json({ ok: false, error: `Token refresh failed: ${tokenRes.status}` }, 502);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    await saveToken({
      serverId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? existing.refreshToken,
      expiresAt,
      scope: tokenData.scope ?? existing.scope,
      tokenType: tokenData.token_type ?? existing.tokenType,
    });

    const status = await getTokenStatus(serverId);
    return c.json({ ok: true, data: status });
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'mcp-oauth-refresh') }, 500);
  }
});

/**
 * DELETE /api/mcp/oauth/:serverId
 * Revoke and delete stored token for the given MCP server.
 */
mcp.delete('/oauth/:serverId', async (c) => {
  const serverId = c.req.param('serverId').trim();
  if (!serverId) return c.json({ ok: false, error: 'serverId required' }, 400);
  await deleteToken(serverId);
  return c.json({ ok: true });
});
