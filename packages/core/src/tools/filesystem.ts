/**
 * Filesystem tools — read, write, and list files within a workspace.
 * All paths are sandboxed to the workspace root for security.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

import type { Tool, ToolResult } from './base.js';

/** Resolve a user-provided path within the workspace, preventing traversal. */
function safePath(workspaceRoot: string, userPath: string): string {
  const resolved = resolve(workspaceRoot, userPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || resolve(resolved) !== resolved && rel.startsWith('..')) {
    throw new Error(`Path "${userPath}" is outside the workspace`);
  }
  return resolved;
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
        const filePath = safePath(workspaceRoot, input.path as string);
        await writeFile(filePath, input.content as string, 'utf-8');
        return { success: true, output: `File written: ${input.path}` };
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
