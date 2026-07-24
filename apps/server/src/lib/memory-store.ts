import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { MemoryItem, MemoryType, CreateMemoryInput, UpdateMemoryInput } from '@neos-work/shared';

const MEMORY_DIR = join(homedir(), '.config', 'neos-work', 'memory');

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function parseFile(filePath: string): MemoryItem | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const content = match[2].trim();

    const get = (key: string): string => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };

    return {
      id: get('id') || randomUUID(),
      name: get('name'),
      type: (get('type') || 'user') as MemoryType,
      enabled: get('enabled') !== 'false',
      content,
      filePath,
      createdAt: get('createdAt') || new Date().toISOString(),
      updatedAt: get('updatedAt') || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeFile(item: MemoryItem): void {
  const frontmatter = [
    `id: ${item.id}`,
    `name: ${item.name}`,
    `type: ${item.type}`,
    `enabled: ${item.enabled}`,
    `createdAt: ${item.createdAt}`,
    `updatedAt: ${item.updatedAt}`,
  ].join('\n');
  writeFileSync(item.filePath, `---\n${frontmatter}\n---\n\n${item.content}`, 'utf-8');
}

export function listMemories(): MemoryItem[] {
  ensureDir();
  // Skip hidden .md files (e.g. .draft.md) — match skill discovery hygiene
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  return files
    .map((f) => parseFile(join(MEMORY_DIR, f)))
    .filter((item): item is MemoryItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMemory(id: string): MemoryItem | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  return listMemories().find((m) => m.id === trimmed) ?? null;
}

const MEMORY_TYPES = new Set(['user', 'session', 'skill', 'reference']);

function normalizeMemoryType(raw: unknown, fallback: MemoryType = 'user'): MemoryType {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return MEMORY_TYPES.has(t) ? (t as MemoryType) : fallback;
}

export function createMemory(input: CreateMemoryInput): MemoryItem {
  ensureDir();
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    throw new Error('name is required');
  }
  const content =
    typeof input.content === 'string' ? input.content.trim() : String(input.content ?? '');
  const type = normalizeMemoryType(input.type);
  const id = randomUUID();
  const now = new Date().toISOString();
  const slug = slugify(name) || id.slice(0, 8);
  const fileName = `${type}_${slug}.md`;
  const filePath = join(MEMORY_DIR, fileName);

  const item: MemoryItem = {
    id,
    name,
    type,
    enabled: input.enabled ?? true,
    content,
    filePath,
    createdAt: now,
    updatedAt: now,
  };
  writeFile(item);
  return item;
}

export function updateMemory(id: string, input: UpdateMemoryInput): MemoryItem | null {
  const existing = getMemory(id);
  if (!existing) return null;

  const name =
    input.name !== undefined
      ? (typeof input.name === 'string' ? input.name.trim() : '')
      : existing.name;
  if (!name) return null;

  const content =
    input.content !== undefined
      ? (typeof input.content === 'string' ? input.content.trim() : String(input.content ?? ''))
      : existing.content;
  const type =
    input.type !== undefined
      ? normalizeMemoryType(input.type, existing.type)
      : existing.type;

  const updated: MemoryItem = {
    ...existing,
    name,
    type,
    content,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date().toISOString(),
  };
  writeFile(updated);
  return updated;
}

export function deleteMemory(id: string): boolean {
  const item = getMemory(id);
  if (!item) return false;
  try {
    unlinkSync(item.filePath);
    return true;
  } catch {
    return false;
  }
}

export function toggleMemory(id: string): MemoryItem | null {
  const item = getMemory(id);
  if (!item) return null;
  return updateMemory(id, { enabled: !item.enabled });
}

export function exportMemories(): string {
  const enabled = listMemories().filter((m) => m.enabled);
  if (enabled.length === 0) return '';
  return enabled
    .map((m) => `### ${m.name} (${m.type})\n\n${m.content}`)
    .join('\n\n---\n\n');
}
