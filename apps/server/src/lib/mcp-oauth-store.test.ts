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

  it('treats invalid expiresAt as expired (fail closed)', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'tok-valid-enough',
      expiresAt: 'not-a-date',
    });
    expect(await isTokenValid(TEST_ID)).toBe(false);
    expect((await getTokenStatus(TEST_ID)).connected).toBe(false);
  });

  it('treats control-char expiresAt as expired (legacy disk hygiene)', async () => {
    // saveToken drops control-char expiresAt; write a legacy-shaped file directly
    const dir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${TEST_ID}.json`);
    await fs.writeFile(
      file,
      JSON.stringify({
        serverId: TEST_ID,
        accessToken: 'tok-valid-enough',
        // Leading control must not strip to a future ISO date
        expiresAt: '\n' + new Date(Date.now() + 60_000).toISOString(),
      }),
      'utf8',
    );
    expect(await isTokenValid(TEST_ID)).toBe(false);
    expect((await getTokenStatus(TEST_ID)).connected).toBe(false);
  });

  it('caps oversized access tokens on save', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'A'.repeat(20_000),
      refreshToken: 'R'.repeat(20_000),
      scope: 'S'.repeat(2_000),
    });
    const loaded = await loadToken(TEST_ID);
    expect(loaded?.accessToken.length).toBe(16_384);
    expect(loaded?.refreshToken?.length).toBe(16_384);
    expect(loaded?.scope?.length).toBe(1_000);
  });

  it('returns null for missing token', async () => {
    expect(await loadToken('does-not-exist-xyz')).toBeNull();
    expect(await isTokenValid('does-not-exist-xyz')).toBe(false);
  });

  it('rejects blank serverId and accessToken on save; trims on load path', async () => {
    await expect(
      saveToken({ serverId: '   ', accessToken: 'tok' }),
    ).rejects.toThrow(/Invalid serverId/i);
    await expect(
      saveToken({ serverId: 'bad\nid', accessToken: 'tok' }),
    ).rejects.toThrow(/Invalid serverId/i);
    await expect(
      saveToken({ serverId: TEST_ID, accessToken: 'tok\nwith\nctrl' }),
    ).rejects.toThrow(/accessToken/i);
    await expect(
      saveToken({ serverId: TEST_ID, accessToken: '   ' }),
    ).rejects.toThrow(/accessToken/i);

    await saveToken({
      serverId: `  ${TEST_ID}  `,
      accessToken: '  secret-token-xyz  ',
    });
    const loaded = await loadToken(`  ${TEST_ID}  `);
    expect(loaded?.accessToken).toBe('secret-token-xyz');
  });

  it('loadToken normalizes legacy disk tokens and drops blank access', async () => {
    const tokenDir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
    await fs.mkdir(tokenDir, { recursive: true });
    const file = path.join(tokenDir, `${TEST_ID}.json`);

    // Legacy file with padded tokens
    await fs.writeFile(
      file,
      JSON.stringify({
        serverId: TEST_ID,
        accessToken: '  legacy-access-token  ',
        refreshToken: '  refresh-pad  ',
        scope: '  read write  ',
        tokenType: '  Bearer  ',
      }),
      'utf8',
    );
    const loaded = await loadToken(TEST_ID);
    expect(loaded?.accessToken).toBe('legacy-access-token');
    expect(loaded?.refreshToken).toBe('refresh-pad');
    expect(loaded?.scope).toBe('read write');
    expect(loaded?.tokenType).toBe('Bearer');

    // Whitespace-only accessToken on disk → treat as missing
    await fs.writeFile(
      file,
      JSON.stringify({ serverId: TEST_ID, accessToken: '   ' }),
      'utf8',
    );
    expect(await loadToken(TEST_ID)).toBeNull();

    // Control-char accessToken on disk → treat as missing
    await fs.writeFile(
      file,
      JSON.stringify({ serverId: TEST_ID, accessToken: 'tok\nwith\nctrl' }),
      'utf8',
    );
    expect(await loadToken(TEST_ID)).toBeNull();
    const status = await getTokenStatus(TEST_ID);
    expect(status.connected).toBe(false);
  });
});

describe('mcp-oauth-store field hygiene', () => {
  it('rejects invalid serverId and control-char accessToken on save', async () => {
    await expect(
      saveToken({ serverId: '', accessToken: 'tok' }),
    ).rejects.toThrow(/serverId/i);

    await expect(
      saveToken({ serverId: 'bad\nid', accessToken: 'tok' }),
    ).rejects.toThrow(/serverId/i);

    await expect(
      saveToken({ serverId: TEST_ID, accessToken: 'tok\nval' }),
    ).rejects.toThrow(/accessToken/i);

    await expect(
      saveToken({ serverId: TEST_ID, accessToken: '   ' }),
    ).rejects.toThrow(/accessToken/i);

    await expect(
      saveToken({ serverId: TEST_ID, accessToken: 42 as unknown as string }),
    ).rejects.toThrow(/accessToken/i);
  });

  it('caps overlong access/refresh/scope/type fields', async () => {
    await saveToken({
      serverId: TEST_ID,
      accessToken: 'a'.repeat(20_000),
      refreshToken: 'r'.repeat(20_000),
      scope: 's'.repeat(2_000),
      tokenType: 't'.repeat(100),
      expiresAt: `  ${new Date(Date.now() + 60_000).toISOString()}  `,
    });
    const loaded = await loadToken(TEST_ID);
    expect(loaded?.accessToken?.length).toBe(16_384);
    expect(loaded?.refreshToken?.length).toBe(16_384);
    expect(loaded?.scope?.length).toBe(1_000);
    expect(loaded?.tokenType?.length).toBe(64);
  });

  it('loadToken returns null for missing/invalid disk payloads', async () => {
    expect(await loadToken('no-such-token-id')).toBeNull();
    expect(await loadToken('bad\nid')).toBeNull();
    expect(await loadToken('')).toBeNull();

    // Write garbage file then load
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const dir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
    const f = path.join(dir, `${TEST_ID}.json`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(f, '{not-json', 'utf8');
    expect(await loadToken(TEST_ID)).toBeNull();

    await fs.writeFile(
      f,
      JSON.stringify({ serverId: TEST_ID, accessToken: 'tok\n' }),
      'utf8',
    );
    expect(await loadToken(TEST_ID)).toBeNull();
  });

  it('loadToken skips symlink token files; saveToken replaces symlink without following', async () => {
    const dir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
    const f = path.join(dir, `${TEST_ID}.json`);
    const outside = path.join(os.tmpdir(), `neos-oauth-out-${process.pid}.json`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      outside,
      JSON.stringify({
        serverId: TEST_ID,
        accessToken: 'leaked-from-outside',
      }),
      'utf8',
    );
    try {
      try {
        await fs.rm(f, { force: true });
        await fs.symlink(outside, f);
      } catch {
        return; // symlink may be restricted
      }
      expect(await loadToken(TEST_ID)).toBeNull();

      await saveToken({
        serverId: TEST_ID,
        accessToken: 'new-safe-token',
      });
      // Must not have written through the symlink into outside
      const outsideRaw = await fs.readFile(outside, 'utf8');
      expect(outsideRaw).toContain('leaked-from-outside');
      expect(outsideRaw).not.toContain('new-safe-token');
      const loaded = await loadToken(TEST_ID);
      expect(loaded?.accessToken).toBe('new-safe-token');
    } finally {
      await fs.rm(f, { force: true }).catch(() => {});
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('deleteToken is idempotent for invalid ids', async () => {
    await expect(deleteToken('')).resolves.toBeUndefined();
    await expect(deleteToken('bad\nid')).resolves.toBeUndefined();
    await expect(deleteToken('missing-id-xyz')).resolves.toBeUndefined();
  });
});
