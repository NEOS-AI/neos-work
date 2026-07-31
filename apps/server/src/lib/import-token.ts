/**
 * Desktop folder-import tokens (PLAN_FOR_V0_5_0 Task 1 / security gate).
 *
 * Single-use, short-lived nonces bound to a validated absolute baseDir path.
 * Desktop issues a token after the native folder picker (or path confirm),
 * then passes it with POST/PUT project when setting baseDir.
 */

import { randomBytes } from 'node:crypto';
import { validateImportBaseDir } from './path-sandbox.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_PATH_LEN = 4096;

export class ImportTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired' | 'used' | 'mismatch' | 'not_found',
  ) {
    super(message);
    this.name = 'ImportTokenError';
  }
}

type Entry = {
  path: string;
  expiresAt: number;
  used: boolean;
};

const store = new Map<string, Entry>();

/** Test / process hygiene: drop all tokens. */
export function clearImportTokens(): void {
  store.clear();
}

function normalizePathKey(path: string): string {
  // Canonicalize separators for compare; realpath already applied at issue time.
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || path;
}

function purgeExpired(now = Date.now()): void {
  for (const [k, v] of store) {
    if (v.used || v.expiresAt <= now) store.delete(k);
  }
}

/**
 * Validate path via path-sandbox and mint a single-use token.
 */
export function issueImportToken(
  rawPath: string,
  opts?: { ttlMs?: number; dataDir?: string },
): { token: string; path: string; expiresAt: string; expiresInMs: number } {
  if (typeof rawPath !== 'string' || /[\0\r\n]/.test(rawPath)) {
    throw new ImportTokenError('Invalid path', 'invalid');
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > MAX_PATH_LEN) {
    throw new ImportTokenError('Invalid path', 'invalid');
  }
  let resolved: string;
  try {
    resolved = validateImportBaseDir(trimmed, {
      dataDir: opts?.dataDir,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid path';
    throw new ImportTokenError(msg, 'invalid');
  }
  const ttl = Math.max(5_000, Math.min(opts?.ttlMs ?? DEFAULT_TTL_MS, 30 * 60 * 1000));
  const token = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + ttl;
  purgeExpired();
  store.set(token, {
    path: normalizePathKey(resolved),
    expiresAt,
    used: false,
  });
  return {
    token,
    path: resolved,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMs: ttl,
  };
}

/**
 * Consume a token for the given path. Single-use; throws ImportTokenError on failure.
 * When `token` is null/undefined/empty, this is a no-op unless `required`.
 * Path is re-validated via validateImportBaseDir so consumer and issuer share the same key.
 */
export function consumeImportToken(
  token: unknown,
  path: string,
  opts?: { required?: boolean; dataDir?: string },
): void {
  const required = opts?.required === true;
  if (token == null || token === '') {
    if (required) throw new ImportTokenError('importToken required', 'not_found');
    return;
  }
  if (typeof token !== 'string' || /[\0\r\n]/.test(token) || token.length > 200) {
    throw new ImportTokenError('Invalid importToken', 'invalid');
  }
  const trimmed = token.trim();
  if (!trimmed) {
    if (required) throw new ImportTokenError('importToken required', 'not_found');
    return;
  }
  purgeExpired();
  const entry = store.get(trimmed);
  if (!entry) {
    throw new ImportTokenError('Unknown or expired importToken', 'not_found');
  }
  if (entry.used) {
    store.delete(trimmed);
    throw new ImportTokenError('importToken already used', 'used');
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(trimmed);
    throw new ImportTokenError('importToken expired', 'expired');
  }

  let resolvedKey: string;
  try {
    resolvedKey = normalizePathKey(
      validateImportBaseDir(path, { dataDir: opts?.dataDir }),
    );
  } catch {
    // Fall back to normalized raw path compare
    resolvedKey = normalizePathKey(path.trim());
  }

  if (entry.path !== resolvedKey) {
    throw new ImportTokenError('importToken path mismatch', 'mismatch');
  }
  entry.used = true;
  store.delete(trimmed);
}

/** Peek remaining tokens (tests). */
export function importTokenCount(): number {
  purgeExpired();
  return store.size;
}
