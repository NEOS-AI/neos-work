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
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md'));
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

export function createMemory(input: CreateMemoryInput): MemoryItem {
  ensureDir();
  const id = randomUUID();
  const now = new Date().toISOString();
  const slug = slugify(input.name) || id.slice(0, 8);
  const fileName = `${input.type}_${slug}.md`;
  const filePath = join(MEMORY_DIR, fileName);

  const item: MemoryItem = {
    id,
    name: input.name,
    type: input.type,
    enabled: input.enabled ?? true,
    content: input.content,
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

  const updated: MemoryItem = {
    ...existing,
    name: input.name ?? existing.name,
    type: input.type ?? existing.type,
    content: input.content ?? existing.content,
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
