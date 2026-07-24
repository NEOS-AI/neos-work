/**
 * Design System Store — scans ~/.config/neos-work/design-systems/ for DESIGN.md files.
 *
 * File structure:
 *   ~/.config/neos-work/design-systems/
 *   └── <name>/
 *       ├── DESIGN.md          (required)
 *       ├── manifest.json      (optional)
 *       ├── tokens.css         (optional)
 *       └── components.html    (optional)
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const DESIGN_SYSTEMS_DIR = path.join(
  os.homedir(),
  '.config',
  'neos-work',
  'design-systems',
);

export interface DesignSystem {
  id: string;
  name: string;
  description?: string;
  path: string;
  hasManifest: boolean;
  hasTokens: boolean;
  hasComponents: boolean;
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

/** List all design systems in the scan directory. */
export async function listDesignSystems(): Promise<DesignSystem[]> {
  await ensureDesignSystemsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(DESIGN_SYSTEMS_DIR);
  } catch {
    return [];
  }

  const results: DesignSystem[] = [];
  for (const entry of entries) {
    const dirPath = path.join(DESIGN_SYSTEMS_DIR, entry);
    const dirStat = await statOrNull(dirPath);
    if (!dirStat?.isDirectory()) continue;

    const designMdPath = path.join(dirPath, 'DESIGN.md');
    const designMdStat = await statOrNull(designMdPath);
    if (!designMdStat) continue; // DESIGN.md required

    const hasManifest = !!(await statOrNull(path.join(dirPath, 'manifest.json')));
    const hasTokens = !!(await statOrNull(path.join(dirPath, 'tokens.css')));
    const hasComponents = !!(await statOrNull(path.join(dirPath, 'components.html')));

    // Try to read description from manifest.json
    let description: string | undefined;
    if (hasManifest) {
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(dirPath, 'manifest.json'), 'utf8'));
        if (typeof manifest?.description === 'string') description = manifest.description;
      } catch {
        // ignore
      }
    }

    results.push({
      id: dirToId(entry),
      name: entry,
      description,
      path: dirPath,
      hasManifest,
      hasTokens,
      hasComponents,
      createdAt: dirStat.birthtime.toISOString(),
      updatedAt: designMdStat.mtime.toISOString(),
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDesignSystem(id: string): Promise<DesignSystem | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const all = await listDesignSystems();
  return all.find((ds) => ds.id === trimmed) ?? null;
}

export async function getDesignSystemContent(id: string): Promise<string | null> {
  const ds = await getDesignSystem(id);
  if (!ds) return null;
  try {
    const content = await fs.readFile(path.join(ds.path, 'DESIGN.md'), 'utf8');
    // Whitespace-only DESIGN.md is treated as missing (Agent skips empty DESIGN CONTEXT)
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

export async function updateDesignSystemContent(id: string, content: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  try {
    await fs.writeFile(path.join(ds.path, 'DESIGN.md'), content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function createDesignSystem(name: string, description?: string): Promise<DesignSystem | null> {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedDescription =
    typeof description === 'string' ? description.trim() || undefined : description;
  if (!trimmedName || !/^[a-zA-Z0-9_-]+$/.test(trimmedName)) return null;
  await ensureDesignSystemsDir();

  const dirPath = path.join(DESIGN_SYSTEMS_DIR, trimmedName);
  try {
    await fs.mkdir(dirPath, { recursive: false });
  } catch {
    return null; // already exists
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

  if (trimmedDescription) {
    await fs.writeFile(
      path.join(dirPath, 'manifest.json'),
      JSON.stringify({ name: trimmedName, description: trimmedDescription, version: '1.0.0' }, null, 2),
      'utf8',
    );
  }

  return getDesignSystem(dirToId(trimmedName));
}

export async function deleteDesignSystem(id: string): Promise<boolean> {
  const ds = await getDesignSystem(id);
  if (!ds) return false;
  try {
    await fs.rm(ds.path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
