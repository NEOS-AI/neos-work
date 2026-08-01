/**
 * MCP servers API — manage MCP server configurations + OAuth 2.0 PKCE flow.
 * Includes built-in presets (TradingView) and CDP health probe for finance workflows.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';

import {
  buildPresetStdioArgs,
  checkTradingViewCdp,
  getMcpPreset,
  listMcpPresets,
  sanitizeMcpInstallPath,
} from '@neos-work/mcp-client';

import { getDb } from '../db/schema.js';
import { isSafeHttpBaseUrl } from '../db/settings.js';
import { escapeHtml, publicErrorMessage, safeError } from '../lib/errors.js';
import {
  saveToken,
  loadToken,
  deleteToken,
  getTokenStatus,
  type McpOAuthToken,
} from '../lib/mcp-oauth-store.js';
import { safeRouteId } from '../lib/path-safety.js';

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

const PENDING_FLOWS_MAX = 256;

// Expire pending flows older than 10 minutes; also bound map size
function cleanExpiredFlows() {
  const threshold = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingFlows) {
    if (v.createdAt < threshold) pendingFlows.delete(k);
  }
  // Drop oldest if still over cap (DoS defense on oauth/start)
  if (pendingFlows.size > PENDING_FLOWS_MAX) {
    const sorted = [...pendingFlows.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const excess = pendingFlows.size - PENDING_FLOWS_MAX;
    for (let i = 0; i < excess; i++) {
      const key = sorted[i]?.[0];
      if (key) pendingFlows.delete(key);
    }
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

/** Practical bound for MCP server lookup ids. */
const MCP_LOOKUP_ID_MAX = 100;

/** @internal Exported for unit tests of id validation. */
export function safeMcpLookupId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > MCP_LOOKUP_ID_MAX) return '';
  return id;
}

function getMcpServer(id: string): McpServerRow | undefined {
  const trimmed = safeMcpLookupId(id);
  if (!trimmed) return undefined;
  return getDb().prepare('SELECT * FROM mcp_server WHERE id = ?').get(trimmed) as McpServerRow | undefined;
}

const MCP_NAME_MAX_CHARS = 200;
const MCP_COMMAND_MAX_CHARS = 500;
const MCP_ARGS_MAX = 50;
const MCP_ARG_MAX_CHARS = 500;

/** @internal Exported for unit tests of validation edges. */
export function createMcpServer(params: {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}): McpServerRow {
  // Control-char check before trim (leading \r\n must not strip to a valid name)
  const nameRaw = typeof params.name === 'string' ? params.name : '';
  if (/[\0\r\n]/.test(nameRaw)) throw new Error('name contains invalid control characters');
  const name = nameRaw.trim();
  if (!name) throw new Error('name is required');
  if (name.length > MCP_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${MCP_NAME_MAX_CHARS})`);
  }
  const transportRaw0 =
    typeof params.transport === 'string' ? params.transport : '';
  if (transportRaw0 && /[\0\r\n]/.test(transportRaw0)) {
    throw new Error('transport must be "stdio" or "http"');
  }
  const transportRaw = transportRaw0.trim().toLowerCase();
  if (transportRaw !== 'stdio' && transportRaw !== 'http') {
    throw new Error('transport must be "stdio" or "http"');
  }
  let command: string | null = null;
  if (typeof params.command === 'string') {
    if (/[\0\r\n]/.test(params.command)) {
      throw new Error('command contains invalid control characters');
    }
    command = params.command.trim() || null;
  } else if (params.command != null) {
    command = null;
  }
  if (command && command.length > MCP_COMMAND_MAX_CHARS) {
    throw new Error(`command exceeds max length (${MCP_COMMAND_MAX_CHARS})`);
  }
  let url: string | null = null;
  if (typeof params.url === 'string') {
    // Control-char check before trim
    if (/[\0\r\n]/.test(params.url)) {
      throw new Error('url contains invalid control characters');
    }
    const u = params.url.trim();
    if (u) {
      if (u.length > 2_048) throw new Error('url exceeds max length (2048)');
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('url must be http(s)');
        }
        url = u;
      } catch (err) {
        if (err instanceof Error && /url must be|invalid control|max length/.test(err.message)) {
          throw err;
        }
        throw new Error('url is invalid');
      }
    }
  }
  const args = Array.isArray(params.args)
    ? params.args
        .map((a) => String(a))
        // Drop control-char args before trim (leading \n must not strip to a valid arg)
        .filter((a) => a.length > 0 && !/[\0\r\n]/.test(a))
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.length <= MCP_ARG_MAX_CHARS)
        .slice(0, MCP_ARGS_MAX)
    : null;
  const argsStr = args && args.length > 0 ? JSON.stringify(args) : null;
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO mcp_server (id, name, transport, command, args, url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, transportRaw, command, argsStr, url);
  return getMcpServer(id)!;
}

function toggleMcpServer(id: string, enabled: boolean): boolean {
  const trimmed = safeMcpLookupId(id);
  if (!trimmed) return false;
  const result = getDb()
    .prepare('UPDATE mcp_server SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, trimmed);
  return result.changes > 0;
}

function deleteMcpServer(id: string): boolean {
  const trimmed = safeMcpLookupId(id);
  if (!trimmed) return false;
  const result = getDb().prepare('DELETE FROM mcp_server WHERE id = ?').run(trimmed);
  return result.changes > 0;
}

function safeParseArgs(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Control-char check before trim
    const args = parsed
      .map((a) => String(a))
      .filter((a) => a.length > 0 && !/[\0\r\n]/.test(a))
      .map((a) => a.trim())
      .filter(Boolean);
    return args.length > 0 ? args : null;
  } catch {
    return null;
  }
}

function rowToResponse(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: safeParseArgs(row.args),
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

// GET /api/mcp-servers/presets — built-in one-click MCP catalogs (TradingView, …)
mcp.get('/presets', (c) => {
  return c.json({ ok: true, data: listMcpPresets() });
});

// GET /api/mcp-servers/tradingview/cdp-health — probe local CDP (default 9222)
mcp.get('/tradingview/cdp-health', async (c) => {
  try {
    const portRaw = c.req.query('port');
    const health = await checkTradingViewCdp(portRaw ?? 9222);
    return c.json({ ok: true, data: health });
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'tradingview-cdp-health') }, 500);
  }
});

/**
 * POST /api/mcp-servers/from-preset
 * Body: { presetId: string, installPath?: string, name?: string }
 * Creates an enabled MCP server row from a built-in preset (TradingView requires installPath).
 */
mcp.post('/from-preset', async (c) => {
  try {
    const body = await c.req.json<{
      presetId?: string;
      installPath?: string;
      name?: string;
    }>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const presetIdRaw = typeof body.presetId === 'string' ? body.presetId : '';
    if (/[\0\r\n]/.test(presetIdRaw)) {
      return c.json({ ok: false, error: 'Missing or invalid "presetId"' }, 400);
    }
    const preset = getMcpPreset(presetIdRaw);
    if (!preset) {
      return c.json({ ok: false, error: 'Unknown MCP preset' }, 404);
    }

    // Optional display name override (default: preset.name)
    let name = preset.name;
    if (typeof body.name === 'string') {
      if (/[\0\r\n]/.test(body.name) || body.name.trim().length > 200) {
        return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
      }
      const n = body.name.trim();
      if (n) name = n;
    }

    // Reject duplicate name (case-sensitive match on stored names)
    const existing = listMcpServers().find((r) => r.name === name);
    if (existing) {
      return c.json(
        { ok: false, error: `MCP server named "${name}" already exists` },
        409,
      );
    }

    if (preset.transport === 'stdio') {
      const installPath = sanitizeMcpInstallPath(body.installPath);
      if (!installPath) {
        return c.json(
          {
            ok: false,
            error:
              'installPath is required (folder containing package.json and src/ from tradingview-mcp)',
          },
          400,
        );
      }

      // Resolve and validate entry file exists (src/server.js for TradingView)
      const entryRel =
        typeof preset.entryRelativePath === 'string' && !/[\0\r\n]/.test(preset.entryRelativePath)
          ? preset.entryRelativePath.trim().replace(/^[/\\]+/, '')
          : '';
      if (!entryRel || entryRel.includes('..')) {
        return c.json({ ok: false, error: 'Preset entry path is invalid' }, 500);
      }
      const entryAbs = path.resolve(installPath, entryRel);
      const rootAbs = path.resolve(installPath);
      // Ensure resolved entry stays under install root
      if (entryAbs !== rootAbs && !entryAbs.startsWith(rootAbs + path.sep)) {
        return c.json({ ok: false, error: 'installPath entry escapes root' }, 400);
      }
      if (!fs.existsSync(entryAbs) || !fs.statSync(entryAbs).isFile()) {
        return c.json(
          {
            ok: false,
            error: `Entry not found: ${entryRel}. Clone tradingview-mcp, npm install, and pass the package root path.`,
          },
          400,
        );
      }

      const built = buildPresetStdioArgs(preset, installPath);
      if (!built) {
        return c.json({ ok: false, error: 'Failed to build preset command args' }, 400);
      }

      const row = createMcpServer({
        name,
        transport: 'stdio',
        command: built.command,
        args: built.args,
      });
      return c.json({ ok: true, data: rowToResponse(row) }, 201);
    }

    return c.json({ ok: false, error: 'Preset transport not supported' }, 400);
  } catch (err) {
    const msg = publicErrorMessage(err, 'mcp-from-preset failed');
    if (/control characters|max length|required|transport|url|invalid|already exists/i.test(msg)) {
      return c.json({ ok: false, error: msg }, 400);
    }
    return c.json({ ok: false, error: safeError(err, 'mcp-from-preset') }, 500);
  }
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

    const nameRaw = typeof body.name === 'string' ? body.name : '';
    // Control-char check before trim
    if (/[\0\r\n]/.test(nameRaw) || nameRaw.trim().length > 200) {
      return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
    }
    const name = nameRaw.trim();
    if (!name) {
      return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
    }
    const transportRaw =
      typeof body.transport === 'string' && !/[\0\r\n]/.test(body.transport)
        ? body.transport.trim().toLowerCase()
        : '';
    if (transportRaw !== 'stdio' && transportRaw !== 'http') {
      return c.json({ ok: false, error: 'transport must be "stdio" or "http"' }, 400);
    }
    const transport = transportRaw as 'stdio' | 'http';
    let command: string | undefined =
      typeof body.command === 'string' ? body.command : undefined;
    if (typeof command === 'string') {
      if (/[\0\r\n]/.test(command)) {
        return c.json({ ok: false, error: 'command contains invalid control characters' }, 400);
      }
      command = command.trim();
      if (command.length > 500) {
        return c.json({ ok: false, error: 'command exceeds max length (500)' }, 400);
      }
    }
    const urlRaw = typeof body.url === 'string' ? body.url : undefined;
    if (typeof urlRaw === 'string' && /[\0\r\n]/.test(urlRaw)) {
      return c.json({ ok: false, error: 'url must be http(s)' }, 400);
    }
    const url = typeof urlRaw === 'string' ? urlRaw.trim() : urlRaw;
    const args = Array.isArray(body.args)
      ? body.args
          .map((a) => {
            const raw = typeof a === 'string' ? a : String(a ?? '');
            if (/[\0\r\n]/.test(raw)) return '';
            return raw.trim();
          })
          .filter((a) => a.length > 0 && a.length <= 500)
          .slice(0, 50)
      : body.args;
    if (transport === 'stdio' && !command) {
      return c.json({ ok: false, error: 'command is required for stdio transport' }, 400);
    }
    if (transport === 'http' && !url) {
      return c.json({ ok: false, error: 'url is required for http transport' }, 400);
    }
    if (transport === 'http' && url && !isSafeHttpBaseUrl(url)) {
      return c.json({ ok: false, error: 'url must be http(s)' }, 400);
    }

    const row = createMcpServer({
      name,
      transport,
      command,
      args,
      url,
    });
    return c.json({ ok: true, data: rowToResponse(row) }, 201);
  } catch (err) {
    const msg = publicErrorMessage(err, 'mcp-create failed');
    if (/control characters|max length|required|transport|url|invalid/i.test(msg)) {
      return c.json({ ok: false, error: msg }, 400);
    }
    return c.json({ ok: false, error: safeError(err, 'mcp-create') }, 500);
  }
});

// POST /api/mcp-servers/:id/toggle
mcp.post('/:id/toggle', async (c) => {
  const id = safeRouteId(c.req.param('id'));
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
  const id = safeRouteId(c.req.param('id'));
  if (!id) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  const deleted = deleteMcpServer(id);
  if (!deleted) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  return c.json({ ok: true });
});

export { mcp };

// ── OAuth 2.0 PKCE routes ───────────────────────────────────────────────────

/**
 * POST /api/mcp-servers/oauth/start
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

    const safeField = (raw: unknown, max = 2_048): string => {
      if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
      const s = raw.trim();
      return s && s.length <= max ? s : '';
    };
    const serverId = safeField(body.serverId, 200);
    const authorizationEndpoint = safeField(body.authorizationEndpoint);
    const tokenEndpoint = safeField(body.tokenEndpoint);
    const clientId = safeField(body.clientId, 500);
    const redirectUri = safeField(body.redirectUri);
    const scope =
      typeof body.scope === 'string' && !/[\0\r\n]/.test(body.scope)
        ? body.scope.trim() || undefined
        : undefined;
    if (scope && scope.length > 1_000) {
      return c.json({ ok: false, error: 'scope too long' }, 400);
    }

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
 * GET /api/mcp-servers/oauth/callback?code=...&state=...
 * Receives the authorization code from the OAuth provider (browser redirect;
 * Bearer auth is exempt — protected by PKCE state).
 * Exchanges it for tokens and stores them.
 */
mcp.get('/oauth/callback', async (c) => {
  const OAUTH_CODE_MAX = 4_096;
  const OAUTH_STATE_MAX = 512;
  const OAUTH_ERROR_MAX = 500;
  const codeRaw = c.req.query('code') ?? '';
  const stateRaw = c.req.query('state') ?? '';
  const errorRaw = c.req.query('error') ?? '';
  // Reject pathological OAuth params before trim (query-string DoS / store abuse)
  if (/[\0\r\n]/.test(codeRaw) || codeRaw.trim().length > OAUTH_CODE_MAX) {
    return c.html('<html><body><h2>Invalid authorization code</h2></body></html>', 400);
  }
  if (/[\0\r\n]/.test(stateRaw) || stateRaw.trim().length > OAUTH_STATE_MAX) {
    return c.html('<html><body><h2>Invalid state</h2></body></html>', 400);
  }
  if (/[\0\r\n]/.test(errorRaw)) {
    return c.html('<html><body><h2>OAuth Error</h2><p>Invalid error parameter</p></body></html>', 400);
  }
  const code = codeRaw.trim();
  const state = stateRaw.trim();
  let error = errorRaw.trim();
  if (error.length > OAUTH_ERROR_MAX) error = error.slice(0, OAUTH_ERROR_MAX);

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

    // Control-char tokens are unusable in Authorization headers (check before trim)
    if (
      typeof tokenData.access_token !== 'string'
      || /[\0\r\n]/.test(tokenData.access_token)
      || !tokenData.access_token.trim()
    ) {
      return c.html(
        '<html><body><h2>Token exchange failed</h2><p>Missing access_token in response</p></body></html>',
        500,
      );
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    const pickTokenField = (raw: unknown, max = 16_384): string | undefined => {
      if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
      const t = raw.trim();
      if (!t || t.length > max) return undefined;
      return t;
    };

    const accessToken = pickTokenField(tokenData.access_token);
    if (!accessToken) {
      return c.html(
        '<html><body><h2>Token exchange failed</h2><p>Invalid access_token in response</p></body></html>',
        500,
      );
    }

    const token: McpOAuthToken = {
      serverId: flow.serverId,
      accessToken,
      refreshToken: pickTokenField(tokenData.refresh_token),
      expiresAt,
      scope: pickTokenField(tokenData.scope, 2_000),
      tokenType: pickTokenField(tokenData.token_type, 100),
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
  const serverId = safeRouteId(c.req.param('serverId'));
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
  const serverId = safeRouteId(c.req.param('serverId'));
  if (!serverId) return c.json({ ok: false, error: 'serverId required' }, 400);
  try {
    const body = await c.req.json<{ tokenEndpoint: string; clientId: string }>().catch(() => null);
    const endpointRaw =
      typeof body?.tokenEndpoint === 'string' ? body.tokenEndpoint : '';
    const clientIdRaw = typeof body?.clientId === 'string' ? body.clientId : '';
    // Control-char check before trim
    if (/[\0\r\n]/.test(endpointRaw) || /[\0\r\n]/.test(clientIdRaw)) {
      return c.json({ ok: false, error: 'tokenEndpoint and clientId required' }, 400);
    }
    const tokenEndpoint = endpointRaw.trim();
    const clientId = clientIdRaw.trim();
    if (!tokenEndpoint || !clientId) {
      return c.json({ ok: false, error: 'tokenEndpoint and clientId required' }, 400);
    }
    if (clientId.length > 500) {
      return c.json({ ok: false, error: 'clientId exceeds max length' }, 400);
    }
    // isSafeHttpBaseUrl also rejects control chars (defense-in-depth)
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
      const msg = publicErrorMessage(err, 'Token refresh network error');
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
  const serverId = safeRouteId(c.req.param('serverId'));
  if (!serverId) return c.json({ ok: false, error: 'serverId required' }, 400);
  await deleteToken(serverId);
  return c.json({ ok: true });
});
