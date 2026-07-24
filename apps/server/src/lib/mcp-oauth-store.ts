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
  await fs.mkdir(TOKEN_DIR, { recursive: true });
}

function sanitizeServerId(serverId: string): string | null {
  const trimmed = typeof serverId === 'string' ? serverId.trim() : '';
  if (!trimmed) return null;
  // Sanitize serverId to prevent path traversal
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || null;
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
  const accessToken =
    typeof token.accessToken === 'string' ? token.accessToken.trim() : '';
  if (!accessToken) throw new Error('accessToken is required');
  const payload: McpOAuthToken = {
    ...token,
    serverId: sanitizeServerId(token.serverId) ?? token.serverId.trim(),
    accessToken,
    refreshToken:
      typeof token.refreshToken === 'string'
        ? token.refreshToken.trim() || undefined
        : token.refreshToken,
    scope: typeof token.scope === 'string' ? token.scope.trim() || undefined : token.scope,
    tokenType:
      typeof token.tokenType === 'string' ? token.tokenType.trim() || undefined : token.tokenType,
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function loadToken(serverId: string): Promise<McpOAuthToken | null> {
  const file = tokenPath(serverId);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as McpOAuthToken;
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

export async function isTokenValid(serverId: string): Promise<boolean> {
  const token = await loadToken(serverId);
  if (!token) return false;
  if (!token.expiresAt) return true; // no expiry — assume valid
  return new Date(token.expiresAt) > new Date();
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
  const expired = token.expiresAt ? new Date(token.expiresAt) <= new Date() : false;
  const access = typeof token.accessToken === 'string' ? token.accessToken.trim() : '';
  return {
    connected: !expired && access.length > 0,
    expiresAt: token.expiresAt,
    scope: token.scope,
    tokenTail: access ? access.slice(-6) : undefined,
  };
}
