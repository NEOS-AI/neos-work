import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteToken,
  getTokenStatus,
  isTokenValid,
  loadToken,
  saveToken,
} from './mcp-oauth-store.js';

const TEST_ID = `test-cov-${process.pid}`;

afterEach(async () => {
  await deleteToken(TEST_ID);
  await deleteToken('../escape');
});

describe('mcp-oauth-store', () => {
  it('saves and loads tokens', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'access-token-abcdef',
      refreshToken: 'refresh',
      scope: 'read',
    });
    const loaded = await loadToken(TEST_ID);
    expect(loaded?.accessToken).toBe('access-token-abcdef');
    expect(loaded?.scope).toBe('read');
  });

  it('sanitizes serverId path traversal', async () => {
    await saveToken({
      serverId: '../escape',
      accessToken: 'tok123456',
    });
    const safePath = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens', '___escape.json');
    const raw = await fs.readFile(safePath, 'utf8');
    expect(JSON.parse(raw).accessToken).toBe('tok123456');
    // should not create outside token dir
    const evil = path.join(os.homedir(), '.config', 'neos-work', 'escape.json');
    await expect(fs.access(evil)).rejects.toBeTruthy();
  });

  it('reports validity and status without raw token', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'secret-token-xyz',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await isTokenValid(TEST_ID)).toBe(true);
    const status = await getTokenStatus(TEST_ID);
    expect(status.connected).toBe(true);
    expect(status.tokenTail).toBe('en-xyz'); // last 6 of secret-token-xyz
    expect(JSON.stringify(status)).not.toContain('secret-token');
  });

  it('marks expired tokens invalid', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'oldtoken',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await isTokenValid(TEST_ID)).toBe(false);
    const status = await getTokenStatus(TEST_ID);
    expect(status.connected).toBe(false);
  });

  it('returns null for missing token', async () => {
    expect(await loadToken('does-not-exist-xyz')).toBeNull();
    expect(await isTokenValid('does-not-exist-xyz')).toBe(false);
  });
});
