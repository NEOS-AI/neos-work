/**
 * Path safety helpers for workspace / file sandbox checks.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

/** Cap workspace path length (path API hygiene). */
export const WORKSPACE_PATH_MAX_CHARS = 4_096;

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
