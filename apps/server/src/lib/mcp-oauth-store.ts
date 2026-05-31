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

function tokenPath(serverId: string): string {
  // Sanitize serverId to prevent path traversal
  const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TOKEN_DIR, `${safe}.json`);
}

export async function saveToken(token: McpOAuthToken): Promise<void> {
  await ensureDir();
  await fs.writeFile(tokenPath(token.serverId), JSON.stringify(token, null, 2), 'utf-8');
}

export async function loadToken(serverId: string): Promise<McpOAuthToken | null> {
  try {
    const raw = await fs.readFile(tokenPath(serverId), 'utf-8');
    return JSON.parse(raw) as McpOAuthToken;
  } catch {
    return null;
  }
}

export async function deleteToken(serverId: string): Promise<void> {
  try {
    await fs.unlink(tokenPath(serverId));
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
  return {
    connected: !expired,
    expiresAt: token.expiresAt,
    scope: token.scope,
    tokenTail: token.accessToken.slice(-6),
  };
}
