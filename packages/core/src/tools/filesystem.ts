/**
 * Filesystem tools — read, write, and list files within a workspace.
 * All paths are sandboxed to the workspace root for security.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

import type { Tool, ToolResult } from './base.js';

const MAX_WRITE_SIZE = 1_048_576; // 1MB

const PROTECTED_PATTERNS = [
  /^\.env($|\.)/,     // .env, .env.local, .env.production, etc.
  /^\.git\//,         // .git directory
  /\.pem$/,
  /\.key$/,
  /^\.ssh\//,
];

function isProtectedPath(relativePath: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(relativePath));
}

/** Resolve a user-provided path within the workspace, preventing traversal and symlink escape. */
function safePath(workspaceRoot: string, userPath: string): string {
  const absoluteRoot = realpathSync(resolve(workspaceRoot));
  const resolved = resolve(absoluteRoot, userPath);
  const rel = relative(absoluteRoot, resolved);

  // Logical path check (prevents .. traversal)
  if (rel.startsWith('..') || (!resolved.startsWith(absoluteRoot + '/') && resolved !== absoluteRoot)) {
    throw new Error(`Path "${userPath}" is outside the workspace`);
  }

  // Resolve symlinks and re-check real path
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    // File may not exist yet (write_file case) — check parent directory
    const parentDir = resolve(resolved, '..');
    try {
      const realParent = realpathSync(parentDir);
      if (!realParent.startsWith(absoluteRoot + '/') && realParent !== absoluteRoot) {
        throw new Error(`Path "${userPath}" resolves outside the workspace via symlink`);
      }
      return resolved;
    } catch {
      throw new Error(`Parent directory for "${userPath}" does not exist`);
    }
  }

  if (!realPath.startsWith(absoluteRoot + '/') && realPath !== absoluteRoot) {
    throw new Error(`Path "${userPath}" resolves outside the workspace via symlink`);
  }
  return realPath;
}

export function createReadFileTool(workspaceRoot: string): Tool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as a string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file within the workspace' },
      },
      required: ['path'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const filePath = safePath(workspaceRoot, input.path as string);
        const content = await readFile(filePath, 'utf-8');
        return { success: true, output: content };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createWriteFileTool(workspaceRoot: string): Tool {
  return {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file within the workspace' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const content = input.content as string;
        if (content.length > MAX_WRITE_SIZE) {
          return { success: false, output: null, error: `Content exceeds max size (${MAX_WRITE_SIZE} bytes)` };
        }

        const userPath = input.path as string;
        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        const filePath = safePath(workspaceRoot, userPath);
        const rel = relative(absoluteRoot, filePath);
        if (isProtectedPath(rel)) {
          return { success: false, output: null, error: `Cannot write to protected path: ${userPath}` };
        }

        await writeFile(filePath, content, 'utf-8');
        return { success: true, output: `File written: ${userPath}` };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createListDirectoryTool(workspaceRoot: string): Tool {
  return {
    name: 'list_directory',
    description: 'List files and directories in a directory. Returns an array of entries with name, type, and size.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the directory (default: workspace root)' },
      },
    },
    async execute(input): Promise<ToolResult> {
      try {
        const dirPath = safePath(workspaceRoot, (input.path as string) || '.');
        const entries = await readdir(dirPath);
        const results = await Promise.all(
          entries
            .filter((name) => !name.startsWith('.'))
            .map(async (name) => {
              try {
                const s = await stat(join(dirPath, name));
                return {
                  name,
                  type: s.isDirectory() ? 'directory' : 'file',
                  size: s.isFile() ? s.size : undefined,
                };
              } catch {
                return { name, type: 'unknown' };
              }
            }),
        );
        return { success: true, output: results };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

/** Create a ToolRegistry-compatible set of all filesystem tools for a workspace. */
export function createFilesystemTools(workspaceRoot: string): Tool[] {
  return [
    createReadFileTool(workspaceRoot),
    createWriteFileTool(workspaceRoot),
    createListDirectoryTool(workspaceRoot),
  ];
}
