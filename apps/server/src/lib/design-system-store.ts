/**
 * Design System Store (v0.5.8 / PLAN Task 5 foundation).
 *
 * Scans user `~/.config/neos-work/design-systems/` and optional bundled
 * monorepo `design-systems/` with name shadowing (user > bundled).
 *
 * Package layout:
 *   <name>/
 *     DESIGN.md          (required)
 *     RULES.md           (optional; agent behavior / corrections)
 *     manifest.json      (optional; od-design-system-project/v1 compatible)
 *     tokens.css         (optional)
 *     components.html    (optional)
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DesignContextFragment } from '@neos-work/agent-runtime';

export const DESIGN_SYSTEMS_DIR = path.join(
  os.homedir(),
  '.config',
  'neos-work',
  'design-systems',
);

export type DesignSystemSource = 'user' | 'bundled';

export interface DesignSystemManifest {
  /** Schema id, e.g. od-design-system-project/v1 */
  schema?: string;
  name?: string;
  description?: string;
  version?: string;
  /** Provenance / origin of the system */
  provenance?: {
    author?: string;
    license?: string;
    sourceUrl?: string;
    importedFrom?: string;
  };
  tokens?: Record<string, string>;
  [key: string]: unknown;
}

export interface DesignSystem {
  id: string;
  name: string;
  description?: string;
  path: string;
  hasManifest: boolean;
  hasTokens: boolean;
  hasComponents: boolean;
  hasRules: boolean;
  rulesUpdatedAt?: string;
  source: DesignSystemSource;
  /** Parsed manifest when present (OD-compatible subset). */
  manifest?: DesignSystemManifest | null;
  createdAt: string;
  updatedAt: string;
}

/** Stable id derived from directory name */
function dirToId(name: string): string {
  return createHash('sha1').update(name).digest('hex').slice(0, 12);
}

async function statOrNull(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/** Regular non-symlink file only (blocks planted escape links). */
async function regularFileStatOrNull(filePath: string) {
  try {
    const st = await fs.lstat(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return st;
  } catch {
    return null;
  }
}

export async function ensureDesignSystemsDir(): Promise<void> {
  // Refuse planted design-systems root symlink (writes/list would follow outside)
  try {
    const st = await fs.lstat(DESIGN_SYSTEMS_DIR);
    if (st.isSymbolicLink()) {
      throw new Error('Invalid design systems directory');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid design systems directory') throw err;
    // ENOENT — create below
  }
  await fs.mkdir(DESIGN_SYSTEMS_DIR, { recursive: true });
}

/** Best-effort locate monorepo `design-systems/` catalog. */
export function resolveBundledDesignSystemsDir(
  explicit?: string | null,
  cwd: string = process.cwd(),
): string | null {
  if (typeof explicit === 'string' && !/[\0\r\n]/.test(explicit)) {
    const t = explicit.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return path.resolve(t);
  }
  const env = process.env.NEOS_BUNDLED_DESIGN_SYSTEMS;
  if (typeof env === 'string' && !/[\0\r\n]/.test(env)) {
    const t = env.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return path.resolve(t);
  }
  const candidates = [
    path.join(cwd, 'design-systems'),
    path.join(cwd, '..', 'design-systems'),
    path.join(cwd, '..', '..', 'design-systems'),
    path.join(cwd, '..', '..', '..', 'design-systems'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return path.resolve(c);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Parse design-system manifest with OD schema tolerance.
 * Accepts `schema` / `$schema` containing `od-design-system-project`.
 */
export function parseDesignSystemManifest(raw: unknown): DesignSystemManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: DesignSystemManifest = {};

  const schemaRaw = o.schema ?? o.$schema;
  if (typeof schemaRaw === 'string' && !/[\0\r\n]/.test(schemaRaw)) {
    const s = schemaRaw.trim().slice(0, 200);
    if (s) out.schema = s;
  }

  if (typeof o.name === 'string' && !/[\0\r\n]/.test(o.name)) {
    const n = o.name.trim().slice(0, 64);
    if (n) out.name = n;
  }
  if (typeof o.description === 'string' && !/\0/.test(o.description)) {
    const d = o.description.replace(/[\r\n]+/g, ' ').trim().slice(0, DESIGN_DESCRIPTION_MAX_CHARS);
    if (d) out.description = d;
  }
  if (typeof o.version === 'string' && !/[\0\r\n]/.test(o.version)) {
    const v = o.version.trim().slice(0, 64);
    if (v) out.version = v;
  }

  if (o.provenance && typeof o.provenance === 'object' && !Array.isArray(o.provenance)) {
    const p = o.provenance as Record<string, unknown>;
    const provenance: NonNullable<DesignSystemManifest['provenance']> = {};
    for (const key of ['author', 'license', 'sourceUrl', 'importedFrom'] as const) {
      const val = p[key];
      if (typeof val === 'string' && !/[\0\r\n]/.test(val)) {
        const t = val.trim().slice(0, 500);
        if (t) provenance[key] = t;
      }
    }
    if (Object.keys(provenance).length > 0) out.provenance = provenance;
  }

  if (o.tokens && typeof o.tokens === 'object' && !Array.isArray(o.tokens)) {
    const tokens: Record<string, string> = {};
    let n = 0;
    for (const [k, v] of Object.entries(o.tokens as Record<string, unknown>)) {
      if (n >= 100) break;
      if (typeof k !== 'string' || /[\0\r\n]/.test(k) || k.length > 100) continue;
      if (typeof v !== 'string' || /[\0\r\n]/.test(v) || v.length > 200) continue;
      tokens[k.trim()] = v.trim();
      n += 1;
    }
    if (n > 0) out.tokens = tokens;
  }

  return out;
}

async function loadFromDir(
  dirPath: string,
  entry: string,
  source: DesignSystemSource,
): Promise<DesignSystem | null> {
  const dirStat = await statOrNull(dirPath);
  if (!dirStat?.isDirectory()) return null;

  const designMdPath = path.join(dirPath, 'DESIGN.md');
  // Refuse DESIGN.md that is a symlink (escape to outside content)
  const designMdStat = await regularFileStatOrNull(designMdPath);
  if (!designMdStat) return null;

  const hasManifest = !!(await regularFileStatOrNull(path.join(dirPath, 'manifest.json')));
  const hasTokens = !!(await regularFileStatOrNull(path.join(dirPath, 'tokens.css')));
  const hasComponents = !!(await regularFileStatOrNull(path.join(dirPath, 'components.html')));
  const rulesStat = await regularFileStatOrNull(path.join(dirPath, 'RULES.md'));
  const hasRules = !!rulesStat;

  let description: string | undefined;
  let manifest: DesignSystemManifest | null = null;
  if (hasManifest) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dirPath, 'manifest.json'), 'utf8'));
      manifest = parseDesignSystemManifest(raw);
      if (manifest?.description) description = manifest.description;
    } catch {
      manifest = null;
    }
  }

  return {
    id: dirToId(entry),
    name: entry,
    description,
    path: dirPath,
    hasManifest,
    hasTokens,
    hasComponents,
    hasRules,
    ...(rulesStat ? { rulesUpdatedAt: rulesStat.mtime.toISOString() } : {}),
    source,
    manifest,
    createdAt: dirStat.birthtime.toISOString(),
    updatedAt: designMdStat.mtime.toISOString(),
  };
}

/** Scan a single design-systems root (no shadowing). */
export async function scanDesignSystemsRoot(
  root: string,
  source: DesignSystemSource,
): Promise<DesignSystem[]> {
  if (typeof root !== 'string' || /[\0\r\n]/.test(root)) return [];
  const base = root.trim();
  if (!base || base.length > 4_096) return [];

  let entries: string[];
  try {
    entries = await fs.readdir(base);
  } catch {
    return [];
  }

  const results: DesignSystem[] = [];
  let count = 0;
  for (const entry of entries) {
    if (count >= 200) break;
    if (!entry || entry.startsWith('.') || /[\0\r\n]/.test(entry) || entry.length > 200) continue;
    const dirPath = path.join(base, entry);
    // Skip planted directory symlinks (do not load DESIGN.md from outside the root)
    try {
      const lst = await fs.lstat(dirPath);
      if (lst.isSymbolicLink() || !lst.isDirectory()) continue;
    } catch {
      continue;
    }
    const ds = await loadFromDir(dirPath, entry, source);
    if (ds) {
      results.push(ds);
      count += 1;
    }
  }
  return results;
}

/**
 * List design systems: user dir first, then bundled; same directory name → user wins.
 */
export async function listDesignSystems(opts?: {
  bundledRoot?: string | null;
  includeBundled?: boolean;
}): Promise<DesignSystem[]> {
  await ensureDesignSystemsDir();
  const includeBundled = opts?.includeBundled !== false;

  const byName = new Map<string, DesignSystem>();

  const userList = await scanDesignSystemsRoot(DESIGN_SYSTEMS_DIR, 'user');
  for (const ds of userList) {
    byName.set(ds.name.toLowerCase(), ds);
  }

  if (includeBundled) {
    const bundled =
      resolveBundledDesignSystemsDir(opts?.bundledRoot ?? null)
      ?? resolveBundledDesignSystemsDir(null);
    if (bundled) {
      const bundledList = await scanDesignSystemsRoot(bundled, 'bundled');
      for (const ds of bundledList) {
        const key = ds.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, ds);
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Practical bound for design-system id lookups (sha1-12). */
const DESIGN_SYSTEM_ID_MAX = 64;

function safeDesignSystemId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > DESIGN_SYSTEM_ID_MAX) return '';
  return id;
}

export async function getDesignSystem(id: string): Promise<DesignSystem | null> {
  const trimmed = safeDesignSystemId(id);
  if (!trimmed) return null;
  const all = await listDesignSystems();
  return all.find((ds) => ds.id === trimmed) ?? null;
}

export async function getDesignSystemContent(id: string): Promise<string | null> {
  const ds = await getDesignSystem(id);
  if (!ds) return null;
  try {
    const p = path.join(ds.path, 'DESIGN.md');
    if (!(await regularFileStatOrNull(p))) return null;
    const content = await fs.readFile(p, 'utf8');
    if (/\0/.test(content)) return null;
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** Optional tokens.css body (read-only context strip). */
export async function getDesignSystemTokens(id: string): Promise<string | null> {
  const ds = await getDesignSystem(id);
  if (!ds?.hasTokens) return null;
  try {
    const p = path.join(ds.path, 'tokens.css');
    if (!(await regularFileStatOrNull(p))) return null;
    const content = await fs.readFile(p, 'utf8');
    if (/\0/.test(content)) return null;
    if (content.length > 256 * 1024) return content.slice(0, 256 * 1024);
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export const DESIGN_MD_MAX_CHARS = 1 * 1024 * 1024;
export const DESIGN_DESCRIPTION_MAX_CHARS = 2_000;
export const RULES_MD_MAX_CHARS = 1 * 1024 * 1024;
export const TOKENS_CSS_MAX_CHARS = 256 * 1024;
export const COMPONENTS_HTML_MAX_CHARS = 256 * 1024;
export const RULES_APPEND_TEXT_MAX = 500;
export const PRUNE_MAX_ENTRIES_DEFAULT = 20;
export const PRUNE_MAX_ENTRIES_MIN = 1;
export const PRUNE_MAX_ENTRIES_MAX = 100;
export const PRUNE_MAX_AGE_DAYS_DEFAULT = 90;
export const PRUNE_MAX_AGE_DAYS_MIN = 1;
export const PRUNE_MAX_AGE_DAYS_MAX = 365;

type RulesAppendSource = 'preview-comment' | 'editor' | 'manual';

export const DEFAULT_RULES_MD = `# Agent rules

This file is the behavioral half of the design harness.
Visual tokens live in DESIGN.md and tokens.css. Do not duplicate palettes here.

## Tools
- Prefer editing the open project HTML/CSS. Do not start from an empty document when a seed file exists.
- Use Design Editor selection / preview comments when present.
- Produce self-contained, clickable HTML (hover, focus, scroll, transitions). Not a screenshot mock.

## Never
- Do not invent a new color palette or font stack when tokens.css defines one.
- Do not use raw hex/rgb for brand colors; use CSS custom properties from tokens.css.
- Do not ship inaccessible contrast or missing focus rings.
- Do not overwrite unrelated manual edits (prefer a minimal patch).

## Preferred workflow
- Start from the seed (current file, components.html, or a starter), generate a few variants as sibling files, then narrow to one.
- After a human correction, wait for an explicit promote; do not rewrite RULES.md yourself unless asked.

## Corrections
<!-- dated bullets, pruned when stale. format: - YYYY-MM-DD: text -->
`;

export const DEFAULT_TOKENS_CSS = `:root {
  --color-primary: #3B82F6;
  --color-secondary: #6366F1;
  --color-success: #10B981;
  --color-error: #EF4444;
  --font-sans: Inter, system-ui, sans-serif;
  --text-base: 1rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
}
`;

export async function updateDesignSystemContent(id: string, content: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  // Bundled systems are read-only
  if (ds.source === 'bundled') return false;
  const body = typeof content === 'string' ? content : String(content ?? '');
  if (body.length > DESIGN_MD_MAX_CHARS) return false;
  if (/\0/.test(body)) return false;
  try {
    const p = path.join(ds.path, 'DESIGN.md');
    // Do not write through a planted symlink
    try {
      const st = await fs.lstat(p);
      if (st.isSymbolicLink()) await fs.unlink(p);
    } catch {
      // ENOENT — ok
    }
    await fs.writeFile(p, body, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function createDesignSystem(name: string, description?: string): Promise<DesignSystem | null> {
  if (typeof name !== 'string' || /[\0\r\n]/.test(name)) return null;
  const trimmedName = name.trim();
  let trimmedDescription: string | undefined;
  if (typeof description === 'string') {
    if (!/[\0\r\n]/.test(description)) {
      const d = description.trim();
      trimmedDescription = d || undefined;
    }
  }
  if (trimmedDescription && trimmedDescription.length > DESIGN_DESCRIPTION_MAX_CHARS) {
    trimmedDescription = trimmedDescription.slice(0, DESIGN_DESCRIPTION_MAX_CHARS);
  }
  if (!trimmedName || trimmedName.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
    return null;
  }
  await ensureDesignSystemsDir();

  const dirPath = path.join(DESIGN_SYSTEMS_DIR, trimmedName);
  try {
    await fs.mkdir(dirPath, { recursive: false });
  } catch {
    return null;
  }

  const templateContent = `# ${trimmedName} Design System

## Overview
${trimmedDescription ?? 'Describe your design system here.'}

## Brand Colors
Use CSS variables from tokens.css in generated CSS. Do not introduce new brand hex/rgb.
- Primary: \`var(--color-primary)\`
- Secondary: \`var(--color-secondary)\`
- Success: \`var(--color-success)\`
- Error: \`var(--color-error)\`

## Typography
- Font family: \`var(--font-sans)\`
- Body: \`var(--text-base)\`

## Spacing
- Base unit: 4px (0.25rem)
- Common sizes: 4, 8, 12, 16, 24, 32, 48, 64

## Component Styles
Describe your component conventions here.
`;

  await fs.writeFile(path.join(dirPath, 'DESIGN.md'), templateContent, 'utf8');

  const manifest = {
    schema: 'od-design-system-project/v1',
    name: trimmedName,
    description: trimmedDescription ?? '',
    version: '1.0.0',
    provenance: { author: 'local' },
  };
  await fs.writeFile(
    path.join(dirPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(dirPath, 'RULES.md'), DEFAULT_RULES_MD, 'utf8');
  await fs.writeFile(path.join(dirPath, 'tokens.css'), DEFAULT_TOKENS_CSS, 'utf8');

  return getDesignSystem(dirToId(trimmedName));
}

export async function deleteDesignSystem(id: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  if (ds.source === 'bundled') return false;
  try {
    await fs.rm(ds.path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function unlinkIfSymlink(filePath: string): Promise<void> {
  try {
    const st = await fs.lstat(filePath);
    if (st.isSymbolicLink()) await fs.unlink(filePath);
  } catch {
    // ENOENT
  }
}

// [ \t] not \s: JS \s includes newlines, which would let ^/$ span blank lines.
const CORRECTIONS_HEADING_RE = /^[ \t]*##[ \t]+corrections[ \t]*$/im;
const NEXT_ATX_HEADING_RE = /^[ \t]*#{1,6}[ \t]+/m;
const SOURCE_COMMENT_RE = /^\s*<!--\s*source:\s*(preview-comment|editor|manual)\s*-->\s*$/;
const CORRECTION_BULLET_RE = /^\s*-\s+(\d{4}-\d{2}-\d{2}):\s*(.*)$/;

function utcDateMinusDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function findCorrectionsHeading(content: string): RegExpExecArray | null {
  CORRECTIONS_HEADING_RE.lastIndex = 0;
  return CORRECTIONS_HEADING_RE.exec(content);
}

function afterHeadingLine(content: string, match: RegExpExecArray): number {
  const lineEnd = content.indexOf('\n', match.index + match[0].length);
  return lineEnd === -1 ? content.length : lineEnd + 1;
}

function insertCorrectionBullet(content: string, insertion: string): string {
  const match = findCorrectionsHeading(content);
  if (!match) {
    const prefix = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
    return `${prefix}## Corrections\n${insertion}`;
  }
  const afterHeadingStart = afterHeadingLine(content, match);
  const afterHeading = content.slice(afterHeadingStart);
  NEXT_ATX_HEADING_RE.lastIndex = 0;
  const next = NEXT_ATX_HEADING_RE.exec(afterHeading);
  const insertAt = next ? afterHeadingStart + next.index : content.length;
  const before = content.slice(0, insertAt);
  const after = content.slice(insertAt);
  const beforeNl = before.endsWith('\n') || before.length === 0 ? before : `${before}\n`;
  return beforeNl + insertion + after;
}

export async function getDesignSystemRules(id: string): Promise<string | null> {
  const ds = await getDesignSystem(id);
  if (!ds) return null;
  try {
    const p = path.join(ds.path, 'RULES.md');
    if (!(await regularFileStatOrNull(p))) return null;
    const content = await fs.readFile(p, 'utf8');
    if (/\0/.test(content)) return null;
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export async function updateDesignSystemRules(id: string, content: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds || ds.source === 'bundled') return false;
  const body = typeof content === 'string' ? content : '';
  if (!body.trim() || /\0/.test(body) || body.length > RULES_MD_MAX_CHARS) return false;
  try {
    const p = path.join(ds.path, 'RULES.md');
    await unlinkIfSymlink(p);
    await fs.writeFile(p, body, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function appendDesignSystemRules(
  id: string,
  text: string,
  source?: string,
): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds || ds.source === 'bundled') return false;
  if (typeof text !== 'string' || /\0/.test(text)) return false;
  const cleaned = text.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  if (!cleaned || cleaned.length > RULES_APPEND_TEXT_MAX) return false;

  const persistSource =
    source === 'preview-comment' || source === 'editor' || source === 'manual'
      ? source
      : undefined;
  const date = new Date().toISOString().slice(0, 10);
  const insertion =
    (persistSource ? `<!-- source: ${persistSource} -->\n` : '') +
    `- ${date}: ${cleaned}\n`;

  const p = path.join(ds.path, 'RULES.md');
  let current = DEFAULT_RULES_MD;
  if (await regularFileStatOrNull(p)) {
    try {
      current = await fs.readFile(p, 'utf8');
    } catch {
      current = DEFAULT_RULES_MD;
    }
  }

  try {
    await unlinkIfSymlink(p);
    await fs.writeFile(p, insertCorrectionBullet(current, insertion), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function pruneDesignSystemRules(
  id: string,
  opts?: { maxEntries?: number; maxAgeDays?: number; nowUtcDate?: string },
): Promise<{ pruned: number } | null> {
  const ds = await getDesignSystem(id);
  if (!ds || ds.source === 'bundled') return null;
  const p = path.join(ds.path, 'RULES.md');
  if (!(await regularFileStatOrNull(p))) return null;

  let content: string;
  try {
    content = await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }

  const match = findCorrectionsHeading(content);
  if (!match) return { pruned: 0 };

  const maxEntries = opts?.maxEntries ?? PRUNE_MAX_ENTRIES_DEFAULT;
  const maxAgeDays = opts?.maxAgeDays ?? PRUNE_MAX_AGE_DAYS_DEFAULT;
  const nowUtcDate = opts?.nowUtcDate ?? new Date().toISOString().slice(0, 10);

  const afterHeadingStart = afterHeadingLine(content, match);
  const head = content.slice(0, match.index);
  const afterHeading = content.slice(afterHeadingStart);
  NEXT_ATX_HEADING_RE.lastIndex = 0;
  const next = NEXT_ATX_HEADING_RE.exec(afterHeading);
  const body = next ? afterHeading.slice(0, next.index) : afterHeading;
  const rest = next ? afterHeading.slice(next.index) : '';

  type Bullet = { date: string; text: string; order: number; source?: RulesAppendSource };
  const bullets: Bullet[] = [];
  let pendingSource: RulesAppendSource | null = null;
  let order = 0;
  for (const line of body.split('\n')) {
    const src = SOURCE_COMMENT_RE.exec(line);
    if (src) {
      pendingSource = src[1] as RulesAppendSource;
      continue;
    }
    const bullet = CORRECTION_BULLET_RE.exec(line);
    if (bullet) {
      bullets.push({
        date: bullet[1]!,
        text: bullet[2]!,
        order,
        source: pendingSource ?? undefined,
      });
      order += 1;
      pendingSource = null;
    } else {
      pendingSource = null;
    }
  }

  const cutoff = utcDateMinusDays(nowUtcDate, maxAgeDays);
  let kept = bullets.filter((b) => b.date >= cutoff);
  kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  if (kept.length > maxEntries) kept = kept.slice(kept.length - maxEntries);

  let section = '## Corrections\n';
  for (const b of kept) {
    if (b.source) section += `<!-- source: ${b.source} -->\n`;
    section += `- ${b.date}: ${b.text}\n`;
  }

  try {
    await unlinkIfSymlink(p);
    await fs.writeFile(p, head + section + rest, 'utf8');
    return { pruned: bullets.length - kept.length };
  } catch {
    return null;
  }
}

export async function updateDesignSystemTokens(id: string, content: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds || ds.source === 'bundled') return false;
  const body = typeof content === 'string' ? content : '';
  if (!body.trim() || /\0/.test(body) || body.length > TOKENS_CSS_MAX_CHARS) return false;
  try {
    const p = path.join(ds.path, 'tokens.css');
    await unlinkIfSymlink(p);
    await fs.writeFile(p, body, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function getDesignSystemComponents(id: string): Promise<string | null> {
  const ds = await getDesignSystem(id);
  if (!ds) return null;
  try {
    const p = path.join(ds.path, 'components.html');
    if (!(await regularFileStatOrNull(p))) return null;
    const content = await fs.readFile(p, 'utf8');
    if (/\0/.test(content)) return null;
    if (content.length > COMPONENTS_HTML_MAX_CHARS) return content.slice(0, COMPONENTS_HTML_MAX_CHARS);
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export async function loadDesignHarnessFragment(
  id: string,
): Promise<DesignContextFragment | null> {
  const ds = await getDesignSystem(id);
  if (!ds) return null;
  const designMd = await getDesignSystemContent(id);
  if (!designMd) return null;
  const [rulesMd, tokensCss] = await Promise.all([
    getDesignSystemRules(id),
    getDesignSystemTokens(id),
  ]);
  return { name: ds.name, designMd, rulesMd, tokensCss };
}
