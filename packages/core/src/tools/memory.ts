/**
 * Memory tools — allow the agent to persist and retrieve information across sessions.
 * Uses a callback pattern so the core package doesn't depend on the server's DB layer.
 */

import type { Tool, ToolResult } from './base.js';

export interface MemoryCallbacks {
  save(key: string, content: string, tags?: string[]): Promise<void>;
  search(query: string, tags?: string[], limit?: number): Promise<{ key: string; content: string; tags?: string[] }[]>;
  remove(key: string): Promise<void>;
}

function normalizeTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t));
  return tags.length > 0 ? tags : undefined;
}

/** Reject null bytes / CR / LF in memory keys (path/storage safety). */
function hasUnsafeKeyChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

function clampLimit(raw: unknown, fallback = 5): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

export function createRememberTool(callbacks: MemoryCallbacks): Tool {
  return {
    name: 'remember',
    description: 'Store a piece of information in persistent memory for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'A short identifier for this memory (e.g. "user_preference_theme")' },
        content: { type: 'string', description: 'The information to remember' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
      },
      required: ['key', 'content'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const key =
          typeof input.key === 'string' ? input.key.trim() : String(input.key ?? '').trim();
        const content =
          typeof input.content === 'string'
            ? input.content.trim()
            : String(input.content ?? '').trim();
        const tags = normalizeTags(input.tags);

        if (!key || key.length > 200) {
          return { success: false, output: null, error: 'Key must be between 1 and 200 characters' };
        }
        if (hasUnsafeKeyChars(key)) {
          return { success: false, output: null, error: 'Key contains invalid control characters' };
        }
        if (!content || content.length > 10_000) {
          return { success: false, output: null, error: 'Content must be between 1 and 10,000 characters' };
        }

        await callbacks.save(key, content, tags);
        return { success: true, output: { saved: key } };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createRecallTool(callbacks: MemoryCallbacks): Tool {
  return {
    name: 'recall',
    description: 'Search persistent memory for stored information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find relevant memories' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
      },
      required: ['query'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const query =
          typeof input.query === 'string' ? input.query.trim() : String(input.query ?? '').trim();
        if (!query) {
          return { success: false, output: null, error: 'query is required' };
        }
        const tags = normalizeTags(input.tags);
        const limit = clampLimit(input.limit, 5);

        const memories = await callbacks.search(query, tags, limit);
        return { success: true, output: { memories } };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createForgetTool(callbacks: MemoryCallbacks): Tool {
  return {
    name: 'forget',
    description: 'Remove a specific memory by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key of the memory to remove' },
      },
      required: ['key'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const key =
          typeof input.key === 'string' ? input.key.trim() : String(input.key ?? '').trim();
        if (!key) {
          return { success: false, output: null, error: 'key is required' };
        }
        if (hasUnsafeKeyChars(key)) {
          return { success: false, output: null, error: 'Key contains invalid control characters' };
        }
        await callbacks.remove(key);
        return { success: true, output: { removed: key } };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createMemoryTools(callbacks: MemoryCallbacks): Tool[] {
  return [
    createRememberTool(callbacks),
    createRecallTool(callbacks),
    createForgetTool(callbacks),
  ];
}
