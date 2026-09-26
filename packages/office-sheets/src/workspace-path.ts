/**
 * Workspace path sandbox for office-sheets Node tools.
 * Keep in lockstep with filesystem.ts safePath.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Cap relative path length accepted by FS tools. */
const MAX_PATH_CHARS = 4_096;

const PROTECTED_PATTERNS = [
  /^\.env($|\.)/,     // .env, .env.local, .env.production, etc.
  /^\.git\//,         // .git directory
  /\.pem$/,
  /\.key$/,
  /^\.ssh\//,
];

export function isProtectedPath(relativePath: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(relativePath));
}

/**
 * True when `abs` is outside `root` (after resolve/realpath).
 * Uses path.sep boundary — bare startsWith(root) allows sibling-prefix escapes.
 * Relative `rel` from path.relative: only `..` / `../` escape (not `...hidden` / `..foo`).
 */
function isOutsideWorkspace(root: string, abs: string, rel?: string): boolean {
  if (abs === root) return false;
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!abs.startsWith(prefix)) return true;
  if (rel !== undefined) {
    // Do not treat filenames like "...hidden" or "..foo" as traversal
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return true;
    if (isAbsolute(rel)) return true;
  }
  return false;
}

/** Resolve a user-provided path within the workspace, preventing traversal and symlink escape. */
export function safePath(workspaceRoot: string, userPath: string): string {
  if (typeof userPath !== 'string') {
    throw new Error('Path is required');
  }
  // Reject null bytes and CR/LF before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(userPath)) {
    throw new Error('Path contains invalid control characters');
  }
  const trimmed = userPath.trim();
  if (!trimmed) {
    throw new Error('Path is required');
  }
  if (trimmed.length > MAX_PATH_CHARS) {
    throw new Error(`Path exceeds max length (${MAX_PATH_CHARS})`);
  }
  const absoluteRoot = realpathSync(resolve(workspaceRoot));
  const resolved = resolve(absoluteRoot, trimmed);
  const rel = relative(absoluteRoot, resolved);

  // Logical path check (prevents .. traversal; allows "..foo" / "...hidden" names)
  if (isOutsideWorkspace(absoluteRoot, resolved, rel)) {
    throw new Error(`Path "${trimmed}" is outside the workspace`);
  }

  // Resolve symlinks and re-check real path
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    // File may not exist yet (write_file case) — check parent directory
    const parentDir = resolve(resolved, '..');
    try {
      const realParent = realpathSync(parentDir);
      if (isOutsideWorkspace(absoluteRoot, realParent)) {
        throw new Error(`Path "${trimmed}" resolves outside the workspace via symlink`);
      }
      return resolved;
    } catch (err) {
      if (err instanceof Error && /outside the workspace/.test(err.message)) throw err;
      throw new Error(`Parent directory for "${trimmed}" does not exist`);
    }
  }

  if (isOutsideWorkspace(absoluteRoot, realPath)) {
    throw new Error(`Path "${trimmed}" resolves outside the workspace via symlink`);
  }
  return realPath;
}
