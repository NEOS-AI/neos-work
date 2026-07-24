/**
 * Path safety helpers for workspace / file sandbox checks.
 */

import { resolve } from 'node:path';
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

/** Validate that a workspace path is within the user's home directory. */
export function validateWorkspacePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  // Reject null bytes and other control characters that can confuse path APIs
  if (/[\0\r\n]/.test(trimmed)) return false;
  if (trimmed.length > WORKSPACE_PATH_MAX_CHARS) return false;
  try {
    const resolved = resolve(trimmed);
    const home = homedir();
    return resolved.startsWith(home + '/') || resolved === home;
  } catch {
    return false;
  }
}
