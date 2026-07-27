/**
 * Design Project file registry (v0.5.0 M1).
 * list / read / write / mkdir under path sandbox; optional revision on write.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileRevisionSource, ProjectFileEntry } from '@neos-work/shared';
import {
  PathSandboxError,
  normalizeProjectRelativePath,
  resolveUnderRoot,
} from './path-sandbox.js';

export const PROJECT_FILE_MAX_CHARS = 2 * 1024 * 1024;
export const PROJECT_LIST_MAX_ENTRIES = 5_000;
const HIDDEN_NAMES = new Set(['.git', '.DS_Store', 'node_modules', '.neos-work']);

export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isHiddenName(name: string): boolean {
  if (HIDDEN_NAMES.has(name)) return true;
  // Allow .html etc; hide dot-directories and classic junk
  if (name.startsWith('.') && name !== '.') return true;
  return false;
}

export function detectEntryFile(rootDir: string): string | null {
  const candidates = ['index.html', 'index.htm', 'src/index.html', 'public/index.html'];
  for (const c of candidates) {
    try {
      const { absolute } = resolveUnderRoot(rootDir, c, { mustExist: true });
      const st = fs.statSync(absolute);
      if (st.isFile()) return c;
    } catch {
      // continue
    }
  }
  return null;
}

export function listProjectFiles(
  rootDir: string,
  options: { maxEntries?: number; entryFile?: string | null } = {},
): ProjectFileEntry[] {
  const max = options.maxEntries ?? PROJECT_LIST_MAX_ENTRIES;
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(path.resolve(rootDir));
  } catch {
    throw new PathSandboxError('project root does not exist', 'not_found');
  }

  const out: ProjectFileEntry[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: rootReal, rel: '' }];

  while (stack.length > 0 && out.length < max) {
    const { abs, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    // Stable order
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= max) break;
      if (isHiddenName(ent.name)) continue;
      if (ent.isSymbolicLink()) {
        // Skip symlinks in listing (security: avoid advertising escapes)
        continue;
      }
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const childAbs = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        out.push({
          path: childRel,
          name: ent.name,
          type: 'directory',
        });
        stack.push({ abs: childAbs, rel: childRel });
      } else if (ent.isFile()) {
        let size: number | undefined;
        let mtimeMs: number | undefined;
        try {
          const st = fs.statSync(childAbs);
          size = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          // ignore
        }
        out.push({
          path: childRel,
          name: ent.name,
          type: 'file',
          size,
          mtimeMs,
          isEntry: options.entryFile ? childRel === options.entryFile : undefined,
        });
      }
    }
  }

  return out;
}

export function readProjectFile(
  rootDir: string,
  relativePath: string,
): { path: string; content: string; hash: string } {
  const { absolute, relative } = resolveUnderRoot(rootDir, relativePath, { mustExist: true });
  const st = fs.statSync(absolute);
  if (!st.isFile()) {
    throw new PathSandboxError('not a file', 'denied');
  }
  if (st.size > PROJECT_FILE_MAX_CHARS) {
    throw new PathSandboxError(
      `file exceeds max size (${PROJECT_FILE_MAX_CHARS} characters)`,
      'denied',
    );
  }
  const content = fs.readFileSync(absolute, 'utf8');
  if (content.length > PROJECT_FILE_MAX_CHARS) {
    throw new PathSandboxError(
      `file exceeds max size (${PROJECT_FILE_MAX_CHARS} characters)`,
      'denied',
    );
  }
  return { path: relative, content, hash: contentHash(content) };
}

export interface WriteProjectFileResult {
  path: string;
  hash: string;
  bytes: number;
  /** Previous content if file existed (for revision capture). */
  previousContent?: string;
  previousHash?: string;
  created: boolean;
}

export function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string,
  options: { source?: FileRevisionSource; mkdir?: boolean } = {},
): WriteProjectFileResult {
  if (typeof content !== 'string') {
    throw new PathSandboxError('content must be a string');
  }
  if (/\0/.test(content)) {
    throw new PathSandboxError('content contains invalid control characters');
  }
  if (content.length > PROJECT_FILE_MAX_CHARS) {
    throw new PathSandboxError(
      `content exceeds max size (${PROJECT_FILE_MAX_CHARS} characters)`,
      'denied',
    );
  }
  // `source` is reserved for callers that persist FileRevision rows (M1 API layer).
  void options.source;

  const { absolute, relative } = resolveUnderRoot(rootDir, relativePath);
  const parent = path.dirname(absolute);
  if (options.mkdir !== false) {
    fs.mkdirSync(parent, { recursive: true });
  } else if (!fs.existsSync(parent)) {
    throw new PathSandboxError('parent directory does not exist', 'not_found');
  }

  let previousContent: string | undefined;
  let previousHash: string | undefined;
  let created = true;
  if (fs.existsSync(absolute)) {
    const st = fs.lstatSync(absolute);
    if (st.isSymbolicLink()) {
      // Re-check symlink target stays inside root before reading/writing
      resolveUnderRoot(rootDir, relative, { mustExist: true });
    }
    if (st.isDirectory()) {
      throw new PathSandboxError('path exists and is not a file', 'denied');
    }
    if (st.isFile() || st.isSymbolicLink()) {
      previousContent = fs.readFileSync(absolute, 'utf8');
      previousHash = contentHash(previousContent);
      created = false;
    } else {
      throw new PathSandboxError('path exists and is not a file', 'denied');
    }
  }

  fs.writeFileSync(absolute, content, 'utf8');
  const hash = contentHash(content);
  return {
    path: relative,
    hash,
    bytes: Buffer.byteLength(content, 'utf8'),
    previousContent,
    previousHash,
    created,
  };
}

export function mkdirProjectPath(rootDir: string, relativePath: string): string {
  const { absolute, relative } = resolveUnderRoot(rootDir, relativePath);
  fs.mkdirSync(absolute, { recursive: true });
  return relative;
}

export function deleteProjectPath(
  rootDir: string,
  relativePath: string,
): { path: string; deleted: boolean } {
  const relative = normalizeProjectRelativePath(relativePath);
  const { absolute } = resolveUnderRoot(rootDir, relative, { mustExist: true });
  // Refuse deleting root
  const rootReal = fs.realpathSync(path.resolve(rootDir));
  if (absolute === rootReal) {
    throw new PathSandboxError('cannot delete project root', 'denied');
  }
  const st = fs.lstatSync(absolute);
  if (st.isDirectory()) {
    fs.rmSync(absolute, { recursive: true, force: false });
  } else {
    fs.unlinkSync(absolute);
  }
  return { path: relative, deleted: true };
}
