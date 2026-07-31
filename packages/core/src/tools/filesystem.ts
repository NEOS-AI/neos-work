/**
 * Filesystem tools — read, write, and list files within a workspace.
 * All paths are sandboxed to the workspace root for security.
 */

import { readFile, writeFile, readdir, stat, rename, glob } from 'node:fs/promises';
import { realpathSync, createReadStream } from 'node:fs';
import { resolve, relative, join, sep, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

import { scrubErrorMessage, type Tool, type ToolResult } from './base.js';

const MAX_WRITE_SIZE = 1_048_576; // 1MB
/** Cap read_file payload so huge files cannot bloat the agent context. */
const MAX_READ_SIZE = 1_048_576; // 1MB
/** Cap list_directory entries returned. */
const MAX_LIST_ENTRIES = 1_000;
/** Cap relative path length accepted by FS tools. */
const MAX_PATH_CHARS = 4_096;

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

/**
 * True when `abs` is outside `root` (after resolve/realpath).
 * Uses path.sep boundary — bare startsWith(root) allows sibling-prefix escapes.
 * Relative `rel` from path.relative: only `..` / `../` escape (not `...hidden` / `..foo`).
 */
function isOutsideWorkspace(root: string, abs: string, rel?: string): boolean {
  if (abs === root) return false;
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!abs.startsWith(prefix)) return true;
  if (rel !== undefined) {
    // Do not treat filenames like "...hidden" or "..foo" as traversal
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return true;
    if (isAbsolute(rel)) return true;
  }
  return false;
}

/** Resolve a user-provided path within the workspace, preventing traversal and symlink escape. */
function safePath(workspaceRoot: string, userPath: string): string {
  if (typeof userPath !== 'string') {
    throw new Error('Path is required');
  }
  // Reject null bytes and CR/LF before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(userPath)) {
    throw new Error('Path contains invalid control characters');
  }
  const trimmed = userPath.trim();
  if (!trimmed) {
    throw new Error('Path is required');
  }
  if (trimmed.length > MAX_PATH_CHARS) {
    throw new Error(`Path exceeds max length (${MAX_PATH_CHARS})`);
  }
  const absoluteRoot = realpathSync(resolve(workspaceRoot));
  const resolved = resolve(absoluteRoot, trimmed);
  const rel = relative(absoluteRoot, resolved);

  // Logical path check (prevents .. traversal; allows "..foo" / "...hidden" names)
  if (isOutsideWorkspace(absoluteRoot, resolved, rel)) {
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
      if (isOutsideWorkspace(absoluteRoot, realParent)) {
        throw new Error(`Path "${trimmed}" resolves outside the workspace via symlink`);
      }
      return resolved;
    } catch (err) {
      if (err instanceof Error && /outside the workspace/.test(err.message)) throw err;
      throw new Error(`Parent directory for "${trimmed}" does not exist`);
    }
  }

  if (isOutsideWorkspace(absoluteRoot, realPath)) {
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
        let content = await readFile(filePath, 'utf-8');
        if (content.length > MAX_READ_SIZE) {
          content =
            content.slice(0, MAX_READ_SIZE) +
            `\n…[truncated: exceeded ${MAX_READ_SIZE} characters]`;
        }
        return { success: true, output: content };
      } catch (err) {
        return { success: false, output: null, error: scrubErrorMessage((err as Error).message) || 'Operation failed' };
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

        // Pass raw path to safePath (control-char check before trim lives there)
        const userPath =
          typeof input.path === 'string' ? input.path : String(input.path ?? '');
        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        const filePath = safePath(workspaceRoot, userPath);
        const rel = relative(absoluteRoot, filePath);
        const displayPath = userPath.trim() || userPath;
        if (isProtectedPath(rel)) {
          return { success: false, output: null, error: `Cannot write to protected path: ${displayPath}` };
        }

        await writeFile(filePath, content, 'utf-8');
        return { success: true, output: `File written: ${displayPath}` };
      } catch (err) {
        return { success: false, output: null, error: scrubErrorMessage((err as Error).message) || 'Operation failed' };
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
        // Pass raw path to safePath (control-char before trim); blank → workspace root
        const rawPath =
          typeof input.path === 'string'
            ? input.path.length === 0 || input.path.trim() === ''
              ? '.'
              : input.path
            : '.';
        // Reject control-char blank-like paths before collapsing to '.'
        if (typeof input.path === 'string' && input.path && /[\0\r\n]/.test(input.path)) {
          return {
            success: false,
            output: null,
            error: 'Path contains invalid control characters',
          };
        }
        const dirPath = safePath(workspaceRoot, rawPath === '' ? '.' : rawPath);
        const entries = await readdir(dirPath);
        const visible = entries.filter((name) => !name.startsWith('.')).slice(0, MAX_LIST_ENTRIES);
        const results = await Promise.all(
          visible.map(async (name) => {
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
        return { success: false, output: null, error: scrubErrorMessage((err as Error).message) || 'Operation failed' };
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
        const patternRaw =
          typeof input.pattern === 'string' ? input.pattern : String(input.pattern ?? '');
        // Control-char check before trim
        if (/[\0\r\n]/.test(patternRaw) || patternRaw.trim().length > 1_000) {
          return {
            success: false,
            output: null,
            error: 'pattern is invalid or exceeds max length (1000)',
          };
        }
        const pattern = patternRaw.trim();
        if (!pattern) {
          return { success: false, output: null, error: 'pattern is required' };
        }
        const searchTypeRaw =
          typeof input.type === 'string' && !/[\0\r\n]/.test(input.type)
            ? input.type.trim().toLowerCase()
            : 'glob';
        const searchType = searchTypeRaw === 'content' ? 'content' : 'glob';

        const absoluteRoot = realpathSync(resolve(workspaceRoot));
        let searchRoot = absoluteRoot;

        if (input.directory != null && input.directory !== '') {
          const dirRaw =
            typeof input.directory === 'string'
              ? input.directory
              : String(input.directory);
          // Control-char check before trim
          if (/[\0\r\n]/.test(dirRaw)) {
            return {
              success: false,
              output: null,
              error: 'directory contains invalid control characters',
            };
          }
          const dir = dirRaw.trim();
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
          if (isOutsideWorkspace(absoluteRoot, realDir)) {
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
        return { success: false, output: null, error: scrubErrorMessage((err as Error).message) || 'Operation failed' };
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

        // Pass raw paths to safePath (control-char before trim)
        const source =
          typeof input.source === 'string' ? input.source : String(input.source ?? '');
        const destination =
          typeof input.destination === 'string'
            ? input.destination
            : String(input.destination ?? '');
        // Control-char check before blank check / trim
        if (/[\0\r\n]/.test(source) || /[\0\r\n]/.test(destination)) {
          return {
            success: false,
            output: null,
            error: 'source/destination contains invalid control characters',
          };
        }
        const sourceTrimmed = source.trim();
        const destTrimmed = destination.trim();
        if (!sourceTrimmed || !destTrimmed) {
          return { success: false, output: null, error: 'source and destination are required' };
        }

        const srcPath = safePath(workspaceRoot, sourceTrimmed);
        const srcRel = relative(absoluteRoot, srcPath);
        if (isProtectedPath(srcRel)) {
          return { success: false, output: null, error: `Cannot move protected path: ${sourceTrimmed}` };
        }

        // Destination may not exist yet — validate via parent resolve
        const destResolved = resolve(absoluteRoot, destTrimmed);
        const destRel = relative(absoluteRoot, destResolved);
        if (isOutsideWorkspace(absoluteRoot, destResolved, destRel)) {
          return { success: false, output: null, error: `Destination is outside the workspace: ${destTrimmed}` };
        }
        if (isProtectedPath(destRel)) {
          return { success: false, output: null, error: `Cannot move to protected path: ${destTrimmed}` };
        }

        await rename(srcPath, destResolved);
        return { success: true, output: { moved: `${source} → ${destination}` } };
      } catch (err) {
        return { success: false, output: null, error: scrubErrorMessage((err as Error).message) || 'Operation failed' };
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
