/**
 * Path safety helpers for workspace / file sandbox checks.
 */

import fs from 'node:fs';
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** Cap workspace path length (path API hygiene). */
export const WORKSPACE_PATH_MAX_CHARS = 4_096;

/** Practical bound for UUID / nanoid route path params. */
export const ROUTE_ID_MAX_CHARS = 100;

/**
 * Sanitize a route/query id: trim, reject blank, control chars, and overlong values.
 * Returns empty string when invalid (callers map to 404).
 */
export function safeRouteId(raw: unknown, max = ROUTE_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Reject control chars before trim — trim() would strip leading/trailing \r\n
  // and silently accept e.g. "\nevil" as "evil".
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

/**
 * Public path tail for API responses — last N segments only.
 * Avoids leaking home directory / absolute host paths to clients.
 */
export function publicPathTail(
  raw: unknown,
  maxSegments = 3,
  maxChars = 400,
): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const t = raw.trim().replace(/\\/g, '/');
  if (!t) return '';
  const segs = Math.min(Math.max(1, Math.floor(maxSegments) || 3), 20);
  const parts = t.split('/').filter(Boolean);
  const tail = parts.slice(-segs).join('/');
  if (!tail) return '';
  const cap = Math.min(Math.max(1, Math.floor(maxChars) || 400), 2_048);
  return tail.length <= cap ? tail : tail.slice(0, cap);
}

function underHomeDir(abs: string, homeAbs: string): boolean {
  const homePrefix = homeAbs.endsWith(sep) ? homeAbs : homeAbs + sep;
  return abs === homeAbs || abs.startsWith(homePrefix);
}

/** Validate that a workspace path is within the user's home directory. */
export function validateWorkspacePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  // Reject control chars before trim so "\n/home/..." is not accepted as home
  if (/[\0\r\n]/.test(path)) return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.length > WORKSPACE_PATH_MAX_CHARS) return false;
  try {
    const resolved = resolve(trimmed);
    // Prefer realpath(home) so macOS /var vs /private/var forms match
    let homeAbs: string;
    try {
      homeAbs = fs.realpathSync(resolve(homedir()));
    } catch {
      homeAbs = resolve(homedir());
    }
    // Lexical containment (sibling-prefix safe via path.sep)
    if (!underHomeDir(resolved, homeAbs) && !underHomeDir(resolved, resolve(homedir()))) {
      return false;
    }
    // If path exists, realpath must still stay under home (block ~/link → /tmp)
    try {
      const real = fs.realpathSync(resolved);
      if (!underHomeDir(real, homeAbs)) return false;
    } catch {
      // ENOENT — allow creating new dirs that are lexically under home
    }
    return true;
  } catch {
    return false;
  }
}
