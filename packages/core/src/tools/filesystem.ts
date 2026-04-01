/**
 * Filesystem tools — read, write, and list files within a workspace.
 * All paths are sandboxed to the workspace root for security.
 */

import { readFile, writeFile, readdir, stat, rename, glob } from 'node:fs/promises';
import { realpathSync, createReadStream } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createInterface } from 'node:readline';

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

export function createSearchFilesTool(workspaceRoot: string): Tool {
  return {
    name: 'search_files',
    description:
      'Search for files in the workspace. Use type="glob" to find files by name pattern, ' +
      'or type="content" to search file contents with a regex pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts") or regex string for content search' },
        directory: { type: 'string', description: 'Subdirectory to search in (default: workspace root)' },
        type: { type: 'string', enum: ['glob', 'content'], description: 'Search type: "glob" (default) or "content"' },
      },
      required: ['pattern'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const pattern = input.pattern as string;
        const searchType = (input.type as string) ?? 'glob';

        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        let searchRoot = absoluteRoot;

        if (input.directory) {
          const resolved = resolve(absoluteRoot, input.directory as string);
          let realDir: string;
          try {
            realDir = realpathSync(resolved);
          } catch {
            return { success: false, output: null, error: `Directory does not exist: ${input.directory}` };
          }
          if (!realDir.startsWith(absoluteRoot + '/') && realDir !== absoluteRoot) {
            return { success: false, output: null, error: `Directory is outside the workspace: ${input.directory}` };
          }
          searchRoot = realDir;
        }

        if (searchType === 'glob') {
          const matches: string[] = [];
          for await (const entry of glob(pattern, { cwd: searchRoot })) {
            matches.push(entry);
            if (matches.length >= 200) break; // cap results
          }
          return { success: true, output: { matches } };
        } else {
          // Content search — grep-style
          let regex: RegExp;
          try {
            regex = new RegExp(pattern);
          } catch {
            return { success: false, output: null, error: `Invalid regex pattern: ${pattern}` };
          }

          const matchingLines: { file: string; line: number; content: string }[] = [];

          // Walk all non-hidden files
          async function searchDir(dirPath: string): Promise<void> {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.')) continue;
              const fullPath = join(dirPath, entry.name);
              if (entry.isDirectory()) {
                await searchDir(fullPath);
              } else if (entry.isFile()) {
                const rl = createInterface({
                  input: createReadStream(fullPath),
                  crlfDelay: Infinity,
                });
                let lineNum = 0;
                for await (const line of rl) {
                  lineNum++;
                  if (regex.test(line)) {
                    const relPath = relative(absoluteRoot, fullPath);
                    matchingLines.push({ file: relPath, line: lineNum, content: line.trim() });
                    if (matchingLines.length >= 500) return;
                  }
                }
              }
            }
          }

          await searchDir(searchRoot);
          return { success: true, output: { matches: matchingLines } };
        }
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export function createMoveFileTool(workspaceRoot: string): Tool {
  return {
    name: 'move_file',
    description: 'Move or rename a file or directory within the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Relative path to the source file or directory' },
        destination: { type: 'string', description: 'Relative path to the destination' },
      },
      required: ['source', 'destination'],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const absoluteRoot = realpathSync(resolve(workspaceRoot));

        const srcPath = safePath(workspaceRoot, input.source as string);
        const srcRel = relative(absoluteRoot, srcPath);
        if (isProtectedPath(srcRel)) {
          return { success: false, output: null, error: `Cannot move protected path: ${input.source}` };
        }

        // Destination may not exist yet — validate parent
        const destResolved = resolve(absoluteRoot, input.destination as string);
        const destRel = relative(absoluteRoot, destResolved);
        if (destRel.startsWith('..')) {
          return { success: false, output: null, error: `Destination is outside the workspace: ${input.destination}` };
        }
        if (isProtectedPath(destRel)) {
          return { success: false, output: null, error: `Cannot move to protected path: ${input.destination}` };
        }

        await rename(srcPath, destResolved);
        return { success: true, output: { moved: `${input.source} → ${input.destination}` } };
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
    createSearchFilesTool(workspaceRoot),
    createMoveFileTool(workspaceRoot),
  ];
}
