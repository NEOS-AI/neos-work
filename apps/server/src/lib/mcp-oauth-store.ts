/**
 * MCP OAuth token store
 * Tokens are persisted to ~/.config/neos-work/mcp-tokens/<serverId>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TOKEN_DIR = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');

export interface McpOAuthToken {
  serverId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO 8601
  scope?: string;
  tokenType?: string;
}

async function ensureDir(): Promise<void> {
  // Refuse planted mcp-tokens root symlink (token writes would follow outside)
  try {
    const st = await fs.lstat(TOKEN_DIR);
    if (st.isSymbolicLink()) {
      throw new Error('Invalid MCP token directory');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid MCP token directory') throw err;
    // ENOENT — create below
  }
  await fs.mkdir(TOKEN_DIR, { recursive: true });
}

/** Cap OAuth token field sizes on disk (runaway secret defense). */
const SERVER_ID_MAX_CHARS = 200;
const ACCESS_TOKEN_MAX_CHARS = 16_384;
const REFRESH_TOKEN_MAX_CHARS = 16_384;
const SCOPE_MAX_CHARS = 1_000;
const TOKEN_TYPE_MAX_CHARS = 64;

function sanitizeServerId(serverId: string): string | null {
  if (typeof serverId !== 'string') return null;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(serverId)) return null;
  const trimmed = serverId.trim();
  if (!trimmed || trimmed.length > SERVER_ID_MAX_CHARS) return null;
  // Sanitize serverId to prevent path traversal
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || null;
}

function capTokenField(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Drop control-char token fields rather than persist them
  if (/[\0\r\n]/.test(raw)) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function tokenPath(serverId: string): string | null {
  const safe = sanitizeServerId(serverId);
  if (!safe) return null;
  return path.join(TOKEN_DIR, `${safe}.json`);
}

export async function saveToken(token: McpOAuthToken): Promise<void> {
  const file = tokenPath(token.serverId);
  if (!file) throw new Error('Invalid serverId');
  await ensureDir();
  // If a planted symlink occupies the path, remove it so writeFile cannot follow outside
  try {
    const st = await fs.lstat(file);
    if (st.isSymbolicLink()) await fs.unlink(file);
  } catch {
    // ENOENT — ok
  }
  if (typeof token.accessToken !== 'string' || /[\0\r\n]/.test(token.accessToken)) {
    throw new Error('accessToken is required');
  }
  let accessToken = token.accessToken.trim();
  if (!accessToken) throw new Error('accessToken is required');
  if (accessToken.length > ACCESS_TOKEN_MAX_CHARS) {
    accessToken = accessToken.slice(0, ACCESS_TOKEN_MAX_CHARS);
  }
  let expiresAt: string | undefined;
  if (typeof token.expiresAt === 'string') {
    if (!/[\0\r\n]/.test(token.expiresAt)) {
      const e = token.expiresAt.trim();
      expiresAt = e || undefined;
      if (expiresAt && expiresAt.length > 64) expiresAt = expiresAt.slice(0, 64);
    }
  }
  const payload: McpOAuthToken = {
    serverId: sanitizeServerId(token.serverId)!,
    accessToken,
    refreshToken: capTokenField(token.refreshToken, REFRESH_TOKEN_MAX_CHARS),
    expiresAt,
    scope: capTokenField(token.scope, SCOPE_MAX_CHARS),
    tokenType: capTokenField(token.tokenType, TOKEN_TYPE_MAX_CHARS),
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function loadToken(serverId: string): Promise<McpOAuthToken | null> {
  const file = tokenPath(serverId);
  if (!file) return null;
  try {
    // Refuse planted symlinks (do not follow into outside token dumps)
    const st = await fs.lstat(file);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const raw = await fs.readFile(file, 'utf-8');
    const token = JSON.parse(raw) as McpOAuthToken;
    // Normalize tokens loaded from disk (legacy files may have whitespace / control chars)
    if (typeof token.accessToken !== 'string' || /[\0\r\n]/.test(token.accessToken)) {
      return null;
    }
    const accessToken = token.accessToken.trim();
    if (!accessToken) return null;
    return {
      ...token,
      serverId: sanitizeServerId(token.serverId) ?? sanitizeServerId(serverId) ?? serverId,
      accessToken:
        accessToken.length > ACCESS_TOKEN_MAX_CHARS
          ? accessToken.slice(0, ACCESS_TOKEN_MAX_CHARS)
          : accessToken,
      refreshToken: capTokenField(token.refreshToken, REFRESH_TOKEN_MAX_CHARS),
      scope: capTokenField(token.scope, SCOPE_MAX_CHARS),
      tokenType: capTokenField(token.tokenType, TOKEN_TYPE_MAX_CHARS),
    };
  } catch {
    return null;
  }
}

export async function deleteToken(serverId: string): Promise<void> {
  const file = tokenPath(serverId);
  if (!file) return;
  try {
    await fs.unlink(file);
  } catch {
    // Not found — ok
  }
}

/** Parse expiresAt; invalid dates are treated as expired (fail closed). */
function isExpiresAtValidFuture(expiresAt: string | undefined): boolean | null {
  if (!expiresAt || typeof expiresAt !== 'string') return null; // no expiry
  // Control-char expiry strings are invalid (check before trim)
  if (/[\0\r\n]/.test(expiresAt)) return false;
  if (!expiresAt.trim()) return null; // no expiry
  const t = Date.parse(expiresAt.trim());
  if (!Number.isFinite(t)) return false; // invalid → treat as expired
  return t > Date.now();
}

export async function isTokenValid(serverId: string): Promise<boolean> {
  const token = await loadToken(serverId);
  if (!token) return false;
  const future = isExpiresAtValidFuture(token.expiresAt);
  if (future === null) return true; // no expiry — assume valid
  return future;
}

/** Returns status info suitable for UI display (no raw token values). */
export async function getTokenStatus(serverId: string): Promise<{
  connected: boolean;
  expiresAt?: string;
  scope?: string;
  tokenTail?: string;
}> {
  const token = await loadToken(serverId);
  if (!token) return { connected: false };
  const future = isExpiresAtValidFuture(token.expiresAt);
  // null = no expiry (connected if token present); false = expired/invalid
  const expired = future === false;
  // Control-char access tokens are unusable (check before trim)
  const access =
    typeof token.accessToken === 'string' && !/[\0\r\n]/.test(token.accessToken)
      ? token.accessToken.trim()
      : '';
  return {
    connected: !expired && access.length > 0,
    expiresAt: token.expiresAt,
    scope: token.scope,
    tokenTail: access ? access.slice(-6) : undefined,
  };
}
