/**
 * Design System Store (v0.5.8 / PLAN Task 5 foundation).
 *
 * Scans user `~/.config/neos-work/design-systems/` and optional bundled
 * monorepo `design-systems/` with name shadowing (user > bundled).
 *
 * Package layout:
 *   <name>/
 *     DESIGN.md          (required)
 *     manifest.json      (optional; od-design-system-project/v1 compatible)
 *     tokens.css         (optional)
 *     components.html    (optional)
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

export async function ensureDesignSystemsDir(): Promise<void> {
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
  const designMdStat = await statOrNull(designMdPath);
  if (!designMdStat) return null;

  const hasManifest = !!(await statOrNull(path.join(dirPath, 'manifest.json')));
  const hasTokens = !!(await statOrNull(path.join(dirPath, 'tokens.css')));
  const hasComponents = !!(await statOrNull(path.join(dirPath, 'components.html')));

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
    const content = await fs.readFile(path.join(ds.path, 'DESIGN.md'), 'utf8');
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
    const content = await fs.readFile(path.join(ds.path, 'tokens.css'), 'utf8');
    if (/\0/.test(content)) return null;
    if (content.length > 256 * 1024) return content.slice(0, 256 * 1024);
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export const DESIGN_MD_MAX_CHARS = 1 * 1024 * 1024;
export const DESIGN_DESCRIPTION_MAX_CHARS = 2_000;

export async function updateDesignSystemContent(id: string, content: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  // Bundled systems are read-only
  if (ds.source === 'bundled') return false;
  const body = typeof content === 'string' ? content : String(content ?? '');
  if (body.length > DESIGN_MD_MAX_CHARS) return false;
  if (/\0/.test(body)) return false;
  try {
    await fs.writeFile(path.join(ds.path, 'DESIGN.md'), body, 'utf8');
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
- Primary: #3B82F6
- Secondary: #6366F1
- Success: #10B981
- Error: #EF4444

## Typography
- Font family: Inter, system-ui, sans-serif
- Heading sizes: 2xl (1.5rem), xl (1.25rem), lg (1.125rem)
- Body: base (1rem), sm (0.875rem)

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
