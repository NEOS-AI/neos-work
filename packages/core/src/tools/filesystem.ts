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
  const trimmed = typeof userPath === 'string' ? userPath.trim() : '';
  if (!trimmed) {
    throw new Error('Path is required');
  }
  // Reject null bytes and CR/LF that can confuse path resolution
  if (/[\0\r\n]/.test(trimmed)) {
    throw new Error('Path contains invalid control characters');
  }
  const absoluteRoot = realpathSync(resolve(workspaceRoot));
  const resolved = resolve(absoluteRoot, trimmed);
  const rel = relative(absoluteRoot, resolved);

  // Logical path check (prevents .. traversal)
  if (rel.startsWith('..') || (!resolved.startsWith(absoluteRoot + '/') && resolved !== absoluteRoot)) {
    throw new Error(`Path "${trimmed}" is outside the workspace`);
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
        throw new Error(`Path "${trimmed}" resolves outside the workspace via symlink`);
      }
      return resolved;
    } catch {
      throw new Error(`Parent directory for "${trimmed}" does not exist`);
    }
  }

  if (!realPath.startsWith(absoluteRoot + '/') && realPath !== absoluteRoot) {
    throw new Error(`Path "${trimmed}" resolves outside the workspace via symlink`);
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
        const userPath = typeof input.path === 'string' ? input.path : String(input.path ?? '');
        const filePath = safePath(workspaceRoot, userPath);
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
        const content =
          typeof input.content === 'string' ? input.content : String(input.content ?? '');
        if (content.length > MAX_WRITE_SIZE) {
          return { success: false, output: null, error: `Content exceeds max size (${MAX_WRITE_SIZE} bytes)` };
        }

        const userPath = typeof input.path === 'string' ? input.path.trim() : String(input.path ?? '');
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
        const rawPath =
          typeof input.path === 'string' ? input.path.trim() || '.' : '.';
        const dirPath = safePath(workspaceRoot, rawPath);
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
        const pattern =
          typeof input.pattern === 'string' ? input.pattern.trim() : String(input.pattern ?? '').trim();
        if (!pattern) {
          return { success: false, output: null, error: 'pattern is required' };
        }
        const searchTypeRaw =
          typeof input.type === 'string' ? input.type.trim().toLowerCase() : 'glob';
        const searchType = searchTypeRaw === 'content' ? 'content' : 'glob';

        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        let searchRoot = absoluteRoot;

        if (input.directory != null && input.directory !== '') {
          const dir =
            typeof input.directory === 'string'
              ? input.directory.trim()
              : String(input.directory);
          if (!dir) {
            return { success: false, output: null, error: 'directory is required when provided' };
          }
          const resolved = resolve(absoluteRoot, dir);
          let realDir: string;
          try {
            realDir = realpathSync(resolved);
          } catch {
            return { success: false, output: null, error: `Directory does not exist: ${dir}` };
          }
          if (!realDir.startsWith(absoluteRoot + '/') && realDir !== absoluteRoot) {
            return { success: false, output: null, error: `Directory is outside the workspace: ${dir}` };
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

        const source =
          typeof input.source === 'string' ? input.source.trim() : String(input.source ?? '').trim();
        const destination =
          typeof input.destination === 'string'
            ? input.destination.trim()
            : String(input.destination ?? '').trim();
        if (!source || !destination) {
          return { success: false, output: null, error: 'source and destination are required' };
        }

        const srcPath = safePath(workspaceRoot, source);
        const srcRel = relative(absoluteRoot, srcPath);
        if (isProtectedPath(srcRel)) {
          return { success: false, output: null, error: `Cannot move protected path: ${source}` };
        }

        // Destination may not exist yet — validate parent
        const destResolved = resolve(absoluteRoot, destination);
        const destRel = relative(absoluteRoot, destResolved);
        if (destRel.startsWith('..')) {
          return { success: false, output: null, error: `Destination is outside the workspace: ${destination}` };
        }
        if (isProtectedPath(destRel)) {
          return { success: false, output: null, error: `Cannot move to protected path: ${destination}` };
        }

        await rename(srcPath, destResolved);
        return { success: true, output: { moved: `${source} → ${destination}` } };
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
