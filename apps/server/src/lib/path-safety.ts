/**
 * Path safety helpers for workspace / file sandbox checks.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

/** Validate that a workspace path is within the user's home directory. */
export function validateWorkspacePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  try {
    const resolved = resolve(path);
    const home = homedir();
    return resolved.startsWith(home + '/') || resolved === home;
  } catch {
    return false;
  }
}
