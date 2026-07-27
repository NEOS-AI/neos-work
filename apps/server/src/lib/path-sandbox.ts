/**
 * Path sandbox for Design Project file access (v0.5.0 M1 / PLAN_FOR_V0_5_0 Task 1).
 *
 * Guarantees:
 * - project-relative paths resolve under realpath(root)
 * - symlink targets that escape root are denied
 * - null bytes / control chars rejected
 * - absolute paths and `..` escape attempts denied
 * - optional deny of re-entering data-dir / OS roots when setting baseDir
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_REL_PATH_MAX = 1_000;
export const PROJECT_ABS_PATH_MAX = 4_096;

export class PathSandboxError extends Error {
  readonly code: 'invalid_path' | 'outside_root' | 'symlink_escape' | 'not_found' | 'denied';

  constructor(
    message: string,
    code: PathSandboxError['code'] = 'invalid_path',
  ) {
    super(message);
    this.name = 'PathSandboxError';
    this.code = code;
  }
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c === 10 || c === 13) return true;
  }
  return false;
}

/** Normalize a project-relative path: strip leading slashes, reject `..` segments & controls. */
export function normalizeProjectRelativePath(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new PathSandboxError('path must be a string');
  }
  if (hasControlChars(raw)) {
    throw new PathSandboxError('path contains invalid control characters');
  }
  let p = raw.trim();
  if (!p) {
    throw new PathSandboxError('path is required');
  }
  if (p.length > PROJECT_REL_PATH_MAX) {
    throw new PathSandboxError('path exceeds max length');
  }
  // Reject absolute (posix / win) and URL-like
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.includes('://')) {
    throw new PathSandboxError('absolute paths are not allowed', 'outside_root');
  }
  // Unify separators
  p = p.replace(/\\/g, '/');
  // Drop leading ./
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+/g, '/').replace(/\/$/, '');
  if (!p || p === '.') {
    throw new PathSandboxError('path is required');
  }
  const segments = p.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new PathSandboxError('path traversal is not allowed', 'outside_root');
    }
  }
  return segments.join('/');
}

/** Realpath if exists; otherwise resolve parent chain to realpath + remaining join. */
export function realpathExistingOrParent(absPath: string): string {
  try {
    return fs.realpathSync(absPath);
  } catch {
    // Walk up until an existing ancestor
    let current = path.resolve(absPath);
    const parts: string[] = [];
    while (true) {
      try {
        const real = fs.realpathSync(current);
        return path.resolve(real, ...parts.reverse());
      } catch {
        const parent = path.dirname(current);
        if (parent === current) {
          return path.resolve(absPath);
        }
        parts.push(path.basename(current));
        current = parent;
      }
    }
  }
}

/**
 * Resolve a project-relative path under root. Throws PathSandboxError if outside.
 * When `mustExist` is true, the target path must exist (and symlink target is checked).
 */
export function resolveUnderRoot(
  rootDir: string,
  relativePath: string,
  options: { mustExist?: boolean } = {},
): { absolute: string; relative: string } {
  if (typeof rootDir !== 'string' || !rootDir.trim() || hasControlChars(rootDir)) {
    throw new PathSandboxError('invalid project root', 'denied');
  }
  if (rootDir.length > PROJECT_ABS_PATH_MAX) {
    throw new PathSandboxError('project root path too long', 'denied');
  }

  let rootReal: string;
  try {
    rootReal = fs.realpathSync(path.resolve(rootDir));
  } catch {
    throw new PathSandboxError('project root does not exist', 'not_found');
  }

  const relative = normalizeProjectRelativePath(relativePath);
  const candidate = path.resolve(rootReal, relative);

  // Fast lexical containment (pre-symlink)
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (candidate !== rootReal && !candidate.startsWith(rootPrefix)) {
    throw new PathSandboxError('path escapes project root', 'outside_root');
  }

  if (options.mustExist) {
    let real: string;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      throw new PathSandboxError('path not found', 'not_found');
    }
    if (real !== rootReal && !real.startsWith(rootPrefix)) {
      throw new PathSandboxError('symlink escapes project root', 'symlink_escape');
    }
    return { absolute: real, relative };
  }

  // For write paths: ensure parent is under root (realpath parent)
  const parent = path.dirname(candidate);
  let parentReal: string;
  try {
    parentReal = fs.realpathSync(parent);
  } catch {
    // Parent may not exist yet for mkdir -p style; validate via realpathExistingOrParent
    parentReal = realpathExistingOrParent(parent);
  }
  if (parentReal !== rootReal && !parentReal.startsWith(rootPrefix)) {
    throw new PathSandboxError('parent path escapes project root', 'outside_root');
  }

  // If the file exists as a symlink, resolve and check
  try {
    const st = fs.lstatSync(candidate);
    if (st.isSymbolicLink()) {
      const real = fs.realpathSync(candidate);
      if (real !== rootReal && !real.startsWith(rootPrefix)) {
        throw new PathSandboxError('symlink escapes project root', 'symlink_escape');
      }
      return { absolute: real, relative };
    }
  } catch (err) {
    if (err instanceof PathSandboxError) throw err;
    // ENOENT is fine for create
  }

  return { absolute: candidate, relative };
}

/** Check whether absPath is contained in rootDir after realpath. */
export function isPathInsideRoot(rootDir: string, absPath: string): boolean {
  try {
    const rootReal = fs.realpathSync(path.resolve(rootDir));
    const targetReal = realpathExistingOrParent(path.resolve(absPath));
    const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
    return targetReal === rootReal || targetReal.startsWith(prefix);
  } catch {
    return false;
  }
}

/**
 * Validate an absolute baseDir for folder import / working-dir change.
 * Rejects: empty, control chars, non-existent, non-directory, OS root, data-dir re-entry
 * when `dataDir` is provided.
 */
export function validateImportBaseDir(
  baseDir: string,
  options: { dataDir?: string; requireExists?: boolean } = {},
): string {
  if (typeof baseDir !== 'string' || hasControlChars(baseDir)) {
    throw new PathSandboxError('invalid baseDir', 'invalid_path');
  }
  const trimmed = baseDir.trim();
  if (!trimmed || trimmed.length > PROJECT_ABS_PATH_MAX) {
    throw new PathSandboxError('invalid baseDir', 'invalid_path');
  }

  const resolved = path.resolve(trimmed);
  // Deny filesystem root
  if (resolved === path.parse(resolved).root || resolved === '/') {
    throw new PathSandboxError('cannot use filesystem root as project baseDir', 'denied');
  }

  const requireExists = options.requireExists !== false;
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    if (requireExists) {
      throw new PathSandboxError('baseDir does not exist', 'not_found');
    }
    real = resolved;
  }

  if (requireExists) {
    let st: fs.Stats;
    try {
      st = fs.statSync(real);
    } catch {
      throw new PathSandboxError('baseDir does not exist', 'not_found');
    }
    if (!st.isDirectory()) {
      throw new PathSandboxError('baseDir must be a directory', 'denied');
    }
  }

  if (options.dataDir) {
    try {
      const dataReal = fs.realpathSync(path.resolve(options.dataDir));
      // Plan: data-dir re-entry deny — never use the daemon data root as a project workspace.
      if (real === dataReal) {
        throw new PathSandboxError('cannot use data directory as project baseDir', 'denied');
      }
      // Allow only the designated projects/ tree under dataDir (default layout).
      // Other dataDir children (db, secrets, media, …) are not valid import roots.
      const dataPrefix = dataReal.endsWith(path.sep) ? dataReal : dataReal + path.sep;
      if (real.startsWith(dataPrefix)) {
        const projectsCandidate = path.join(dataReal, 'projects');
        let projectsReal: string;
        try {
          projectsReal = fs.realpathSync(projectsCandidate);
        } catch {
          projectsReal = path.resolve(projectsCandidate);
        }
        const projectsPrefix = projectsReal.endsWith(path.sep)
          ? projectsReal
          : projectsReal + path.sep;
        if (real !== projectsReal && !real.startsWith(projectsPrefix)) {
          throw new PathSandboxError(
            'cannot use internal data paths as project baseDir',
            'denied',
          );
        }
      }
    } catch (err) {
      if (err instanceof PathSandboxError) throw err;
    }
  }

  // Soft home check: imported folders should typically be under home (align with workspace path policy).
  // Allow OS temp for tests/CI. Compare against realpath forms — on macOS tmpdir is often
  // `/var/folders/...` while realpath is `/private/var/folders/...`.
  if (process.env.NEOS_ALLOW_ANY_BASEDIR !== '1') {
    const home = (() => {
      try {
        return fs.realpathSync(os.homedir());
      } catch {
        return path.resolve(os.homedir());
      }
    })();
    const tmp = (() => {
      try {
        return fs.realpathSync(os.tmpdir());
      } catch {
        return path.resolve(os.tmpdir());
      }
    })();
    const homePrefix = home.endsWith(path.sep) ? home : home + path.sep;
    const tmpPrefix = tmp.endsWith(path.sep) ? tmp : tmp + path.sep;
    const underHome = real === home || real.startsWith(homePrefix);
    const underTmp = real === tmp || real.startsWith(tmpPrefix);
    if (!underHome && !underTmp) {
      throw new PathSandboxError('baseDir must be under home or temp directory', 'denied');
    }
  }

  return real;
}

/** Default projects root: ~/.config/neos-work/projects (or NEOS_DATA_DIR/projects). */
export function defaultProjectsRoot(): string {
  if (process.env.NEOS_PROJECTS_DIR && !hasControlChars(process.env.NEOS_PROJECTS_DIR)) {
    return path.resolve(process.env.NEOS_PROJECTS_DIR.trim());
  }
  if (process.env.NEOS_DATA_DIR && !hasControlChars(process.env.NEOS_DATA_DIR)) {
    return path.join(path.resolve(process.env.NEOS_DATA_DIR.trim()), 'projects');
  }
  return path.join(os.homedir(), '.config', 'neos-work', 'projects');
}

export function defaultDataDir(): string {
  if (process.env.NEOS_DATA_DIR && !hasControlChars(process.env.NEOS_DATA_DIR)) {
    return path.resolve(process.env.NEOS_DATA_DIR.trim());
  }
  return path.join(os.homedir(), '.config', 'neos-work');
}
