/**
 * User / workspace skill roots and sibling-safe path checks.
 * Do not cache NEOS_DATA_DIR at module load.
 */

import { existsSync, realpathSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { readSkillProvenance, SKILL_PROVENANCE_FILENAME } from './provenance.js';

export type SkillOccupancy =
  | 'empty'
  | 'orphan'
  | 'occupied_skill'
  | 'occupied_plugin'
  | 'occupied_unknown'
  | 'same_remote'
  | 'occupied_remote';

export function resolveUserSkillsDir(
  env: NodeJS.ProcessEnv = process.env,
  home: () => string = homedir,
): string {
  const raw = env.NEOS_DATA_DIR;
  if (typeof raw === 'string' && !/[\0\r\n]/.test(raw) && raw.trim()) {
    return join(resolve(raw.trim()), 'skills');
  }
  return join(home(), '.config', 'neos-work', 'skills');
}

export function resolveWorkspaceSkillsDir(workspacePath: string): string {
  return resolve(workspacePath, '.neos-work', 'skills');
}

/** Sibling-safe. Same dual-check idea as validateWorkspacePath / underHomeDir. */
export function isPathInside(root: string, candidate: string): boolean {
  const rootLex = resolve(root);
  const candLex = resolve(candidate);
  let rootReal: string | null = null;
  let candReal: string | null = null;
  try {
    if (existsSync(rootLex)) rootReal = realpathSync(rootLex);
  } catch {
    /* ignore */
  }
  try {
    if (existsSync(candLex)) candReal = realpathSync(candLex);
  } catch {
    /* ignore */
  }
  const inside = (abs: string, rootAbs: string) => {
    const prefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
    return abs === rootAbs || abs.startsWith(prefix);
  };
  // Both exist: compare realpaths (macOS /var vs /private/var).
  if (rootReal && candReal) return inside(candReal, rootReal);
  if (!inside(candLex, rootLex) && !(rootReal && inside(candLex, rootReal))) return false;
  if (candReal) {
    const bound = rootReal ?? rootLex;
    if (!inside(candReal, bound)) return false;
  }
  return true;
}

/**
 * Directory name for a skill package. Empty string means reject.
 * Spaces/`_` → `-`; strip other chars; collapse hyphens; 1–64 kebab.
 */
export function sanitizeSkillDirName(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length >= 1 ? slug : '';
}

async function hasMarkerFile(dir: string, name: string): Promise<boolean> {
  try {
    const st = await lstat(join(dir, name));
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Filesystem-only occupancy. No DB / crystallize lookup. */
export async function classifyOccupancy(
  dir: string,
  expectedRemoteId?: string,
): Promise<SkillOccupancy> {
  if (typeof dir !== 'string' || !dir.trim() || /[\0\r\n]/.test(dir)) return 'empty';
  const base = resolve(dir.trim());
  let names: string[] = [];
  try {
    const st = await lstat(base);
    if (!st.isDirectory()) return 'occupied_unknown';
    names = await readdir(base);
  } catch {
    return 'empty';
  }

  const visible = names.filter((n) => n && !n.startsWith('.') && !/[\0\r\n]/.test(n));
  const hasSkillMd = await hasMarkerFile(base, 'SKILL.md');
  const hasPlugin = await hasMarkerFile(base, 'open-design.json');
  const sidecar = await readSkillProvenance(base);
  const remoteId = sidecar?.id ?? null;

  if (hasSkillMd && remoteId) {
    if (expectedRemoteId && remoteId === expectedRemoteId) return 'same_remote';
    return 'occupied_remote';
  }
  if (hasSkillMd) return 'occupied_skill';
  if (hasPlugin) return 'occupied_plugin';
  if (visible.length === 0) {
    return names.length === 0 ? 'empty' : 'orphan';
  }
  // Sidecar-only leftover is reusable; sidecar plus other files is not.
  if (remoteId && visible.length === 1 && visible[0] === SKILL_PROVENANCE_FILENAME) {
    return 'orphan';
  }
  return 'occupied_unknown';
}
