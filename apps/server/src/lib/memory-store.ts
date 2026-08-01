import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  lstatSync,
} from 'node:fs';
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

const MEMORY_TYPES = new Set(['user', 'session', 'skill', 'reference']);

function normalizeMemoryType(raw: unknown, fallback: MemoryType = 'user'): MemoryType {
  // Control-char before trim so leading \n cannot strip to a known type
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return fallback;
  const t = raw.trim().toLowerCase();
  return MEMORY_TYPES.has(t) ? (t as MemoryType) : fallback;
}

function parseFile(filePath: string): MemoryItem | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    // Null-byte body is unusable
    const contentRaw = match[2] ?? '';
    if (/\0/.test(contentRaw)) return null;
    const content = contentRaw.trim();

    const get = (key: string): string => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      if (!m?.[1]) return '';
      // Control-char field values dropped (check before trim)
      if (/[\0\r\n]/.test(m[1])) return '';
      return m[1].trim();
    };

    const name = get('name');
    // Name is required for list/UI; skip corrupt files rather than surface blank
    if (!name) return null;

    return {
      id: get('id') || randomUUID(),
      name,
      type: normalizeMemoryType(get('type')),
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
  // Skip hidden .md files and symlinks (escape links must not surface outside content)
  const files = readdirSync(MEMORY_DIR).filter((f) => {
    if (!f.endsWith('.md') || f.startsWith('.')) return false;
    try {
      const st = lstatSync(join(MEMORY_DIR, f));
      return st.isFile() && !st.isSymbolicLink();
    } catch {
      return false;
    }
  });
  return files
    .map((f) => parseFile(join(MEMORY_DIR, f)))
    .filter((item): item is MemoryItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Practical bound for memory id lookups. */
const LOOKUP_ID_MAX_CHARS = 100;

function safeLookupId(raw: unknown, max = LOOKUP_ID_MAX_CHARS): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > max) return '';
  return id;
}

export function getMemory(id: string): MemoryItem | null {
  const trimmed = safeLookupId(id);
  if (!trimmed) return null;
  return listMemories().find((m) => m.id === trimmed) ?? null;
}

/** Cap file-store memory body (plan Task 1 polish — align with settings/artifacts). */
export const MEMORY_CONTENT_MAX_CHARS = 1 * 1024 * 1024;
/** Cap memory name length. */
export const MEMORY_NAME_MAX_CHARS = 200;

export function createMemory(input: CreateMemoryInput): MemoryItem {
  ensureDir();
  const nameRaw = typeof input.name === 'string' ? input.name : '';
  // Control-char check before trim
  if (/[\0\r\n]/.test(nameRaw)) {
    throw new Error('name contains invalid control characters');
  }
  const name = nameRaw.trim();
  if (!name) {
    throw new Error('name is required');
  }
  if (name.length > MEMORY_NAME_MAX_CHARS) {
    throw new Error(`name exceeds max length (${MEMORY_NAME_MAX_CHARS})`);
  }
  const contentRaw =
    typeof input.content === 'string' ? input.content : String(input.content ?? '');
  if (/\0/.test(contentRaw)) {
    throw new Error('content contains invalid control characters');
  }
  const content = contentRaw.trim();
  if (content.length > MEMORY_CONTENT_MAX_CHARS) {
    throw new Error(`content exceeds max size (${MEMORY_CONTENT_MAX_CHARS} characters)`);
  }
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

  let name = existing.name;
  if (input.name !== undefined) {
    const nameRaw = typeof input.name === 'string' ? input.name : '';
    if (/[\0\r\n]/.test(nameRaw)) return null;
    name = nameRaw.trim();
    if (!name || name.length > MEMORY_NAME_MAX_CHARS) return null;
  }

  let content = existing.content;
  if (input.content !== undefined) {
    const contentRaw =
      typeof input.content === 'string' ? input.content : String(input.content ?? '');
    if (/\0/.test(contentRaw)) return null;
    content = contentRaw.trim();
    if (content.length > MEMORY_CONTENT_MAX_CHARS) return null;
  }
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

/** Cap aggregate export text (matches AgentNode memory inject bound). */
export const MEMORY_EXPORT_MAX_CHARS = 32_000;

export function exportMemories(): string {
  const enabled = listMemories().filter((m) => m.enabled);
  if (enabled.length === 0) return '';
  let out = '';
  for (const m of enabled) {
    const block = `### ${m.name} (${m.type})\n\n${m.content}`;
    const next = out ? `${out}\n\n---\n\n${block}` : block;
    if (next.length > MEMORY_EXPORT_MAX_CHARS) {
      out =
        (out || block.slice(0, MEMORY_EXPORT_MAX_CHARS)) +
        '\n\n…[memory export truncated]';
      break;
    }
    out = next;
  }
  return out;
}
