/**
 * Skill discovery — package roots (SKILL.md + assets/references/examples),
 * flat *.md, bundled catalog, and name shadowing (v0.5.7 / PLAN Task 4).
 *
 * Precedence (highest first): local workspace → user global → bundled.
 * Same manifest.name: higher-priority source wins (user shadows bundled).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

import type { Skill, SkillExampleCard, SkillSource } from '@neos-work/shared';
import { parseSkillFile } from './parser.js';

const GLOBAL_SKILL_DIR = join(homedir(), '.config', 'neos-work', 'skills');

const ENTRY_MAX = 500;
const FILE_MAX_BYTES = 1 * 1024 * 1024;
const EXAMPLES_MAX = 40;
const ASSETS_LIST_MAX = 100;

export interface DiscoverSkillsOptions {
  /** Override bundled skills root (repo `skills/`). */
  bundledRoot?: string | null;
  /** Include bundled catalog (default true). */
  includeBundled?: boolean;
  /** Include ~/.config/neos-work/skills (default true). */
  includeGlobal?: boolean;
}

function isSafeRelName(name: string): boolean {
  return (
    typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && !name.startsWith('.')
    && !/[\0\r\n/\\]/.test(name)
  );
}

async function listSafeFiles(dir: string, exts?: string[]): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const out: string[] = [];
    for (const entry of entries) {
      if (out.length >= ASSETS_LIST_MAX) break;
      if (!isSafeRelName(entry)) continue;
      if (exts && !exts.some((e) => entry.toLowerCase().endsWith(e))) continue;
      const p = join(dir, entry);
      try {
        const s = await stat(p);
        if (s.isFile() && s.size <= FILE_MAX_BYTES) out.push(entry);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function deriveExampleCards(
  packageDir: string,
  skillName: string,
): Promise<SkillExampleCard[]> {
  const examplesDir = join(packageDir, 'examples');
  const files = await listSafeFiles(examplesDir, ['.html', '.htm']);
  const cards: SkillExampleCard[] = [];
  for (const file of files.slice(0, EXAMPLES_MAX)) {
    const key = file.replace(/\.html?$/i, '');
    if (!key || /[^a-zA-Z0-9._-]/.test(key)) continue;
    const id = `${skillName}:${key}`.slice(0, 200);
    cards.push({
      id,
      key,
      path: join(examplesDir, file),
      title: key.replace(/[-_]+/g, ' '),
    });
  }
  return cards;
}

async function loadPackageSkill(
  packageDir: string,
  source: SkillSource,
): Promise<Skill | null> {
  const skillMd = join(packageDir, 'SKILL.md');
  try {
    const s = await stat(skillMd);
    if (!s.isFile() || s.size > FILE_MAX_BYTES) return null;
    const content = await readFile(skillMd, 'utf-8');
    const skill = parseSkillFile(content, skillMd, source);
    if (!skill) return null;
    const assets = await listSafeFiles(join(packageDir, 'assets'));
    const references = await listSafeFiles(join(packageDir, 'references'));
    const examples = await deriveExampleCards(packageDir, skill.manifest.name);
    return {
      ...skill,
      packageDir,
      assets: assets.length > 0 ? assets : undefined,
      references: references.length > 0 ? references : undefined,
      examples: examples.length > 0 ? examples : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a skill root: package dirs (`name/SKILL.md`) + flat `*.md` files.
 */
export async function scanSkillRoot(
  dir: string,
  source: SkillSource,
): Promise<Skill[]> {
  const skills: Skill[] = [];
  if (typeof dir !== 'string' || /[\0\r\n]/.test(dir)) return skills;
  const base = dir.trim();
  if (!base || base.length > 4_096) return skills;

  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return skills;
  }

  let count = 0;
  for (const entry of entries) {
    if (count >= ENTRY_MAX) break;
    if (!entry || entry.startsWith('.') || /[\0\r\n]/.test(entry) || entry.length > 200) {
      continue;
    }
    const full = join(base, entry);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        const pkg = await loadPackageSkill(full, source);
        if (pkg) {
          skills.push(pkg);
          count += 1;
        }
        continue;
      }
      if (!s.isFile()) continue;
      // Flat markdown (legacy). Skip SKILL.md at root of skills dir as package-less file name.
      if (!entry.endsWith('.md')) continue;
      if (s.size > FILE_MAX_BYTES) continue;
      const content = await readFile(full, 'utf-8');
      const skill = parseSkillFile(content, full, source);
      if (skill) {
        skills.push(skill);
        count += 1;
      }
    } catch {
      // Skip unreadable
    }
  }

  return skills;
}

/**
 * Merge skill lists with shadowing: first occurrence of a name wins.
 * Callers must pass roots in priority order (highest first).
 */
export function mergeSkillsByPrecedence(lists: Skill[][]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const list of lists) {
    for (const skill of list) {
      const key = skill.manifest.name.trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, skill);
    }
  }
  return [...byName.values()].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );
}

/** Best-effort locate monorepo / install `skills/` catalog. */
export function resolveBundledSkillsDir(
  explicit?: string | null,
  cwd: string = process.cwd(),
): string | null {
  if (typeof explicit === 'string' && !/[\0\r\n]/.test(explicit)) {
    const t = explicit.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return resolve(t);
  }
  const env = process.env.NEOS_BUNDLED_SKILLS;
  if (typeof env === 'string' && !/[\0\r\n]/.test(env)) {
    const t = env.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return resolve(t);
  }
  const candidates = [
    join(cwd, 'skills'),
    join(cwd, '..', 'skills'),
    join(cwd, '..', '..', 'skills'),
    join(cwd, '..', '..', '..', 'skills'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return resolve(c);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function discoverSkills(
  workspacePath?: string,
  opts?: DiscoverSkillsOptions,
): Promise<Skill[]> {
  const includeGlobal = opts?.includeGlobal !== false;
  const includeBundled = opts?.includeBundled !== false;

  const priorityLists: Skill[][] = [];

  // 1) Local workspace — highest priority
  if (typeof workspacePath === 'string' && !/[\0\r\n]/.test(workspacePath)) {
    const ws = workspacePath.trim();
    if (ws && ws.length <= 4_096) {
      const localDir = resolve(ws, '.neos-work', 'skills');
      priorityLists.push(await scanSkillRoot(localDir, 'local'));
    }
  }

  // 2) User global
  if (includeGlobal) {
    priorityLists.push(await scanSkillRoot(GLOBAL_SKILL_DIR, 'global'));
  }

  // 3) Bundled catalog
  if (includeBundled) {
    const bundled = resolveBundledSkillsDir(opts?.bundledRoot ?? null);
    if (bundled) {
      priorityLists.push(await scanSkillRoot(bundled, 'bundled'));
    }
  }

  return mergeSkillsByPrecedence(priorityLists);
}

export { GLOBAL_SKILL_DIR };
