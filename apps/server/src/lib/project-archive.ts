/**
 * Design Project ZIP export / import (v0.5.9 / PLAN Task 1 archive).
 * Format: neos-project zip with project.json + files/** (no symlinks).
 */

import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import type { DesignProject } from '@neos-work/shared';
import {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  PROJECT_FILE_MAX_CHARS,
} from './project-files.js';
import { PathSandboxError } from './path-sandbox.js';

export const PROJECT_ZIP_FORMAT = 'neos-project';
export const PROJECT_ZIP_FORMAT_VERSION = 1;
export const PROJECT_ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const PROJECT_ZIP_MAX_FILES = 500;
export const PROJECT_ZIP_MAX_ENTRY_CHARS = PROJECT_FILE_MAX_CHARS;

export interface ProjectZipManifest {
  version: number;
  format: typeof PROJECT_ZIP_FORMAT;
  exportedAt: string;
  project: {
    name: string;
    entryFile: string | null;
    designSystemId: string | null;
    meta?: Record<string, unknown>;
  };
}

export async function buildProjectZipBuffer(
  project: DesignProject,
): Promise<Buffer> {
  const files = listProjectFiles(project.baseDir, {
    entryFile: project.entryFile,
  }).filter((f) => f.type === 'file');

  const manifest: ProjectZipManifest = {
    version: PROJECT_ZIP_FORMAT_VERSION,
    format: PROJECT_ZIP_FORMAT,
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      entryFile: project.entryFile,
      designSystemId: project.designSystemId,
      meta: project.meta,
    },
  };

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'project.json' });
  archive.append(
    `# ${project.name}\n\nNEOS Work Design Project export.\n\nFiles: ${files.length}\n`,
    { name: 'README.md' },
  );

  let count = 0;
  for (const f of files) {
    if (count >= PROJECT_ZIP_MAX_FILES) break;
    if (!f.path || f.path.includes('..') || /[\0]/.test(f.path)) continue;
    try {
      const { content } = readProjectFile(project.baseDir, f.path);
      // Skip binary-ish / huge
      if (typeof content !== 'string') continue;
      if (/\0/.test(content)) continue;
      archive.append(content, { name: `files/${f.path}` });
      count += 1;
    } catch {
      // skip unreadable
    }
  }

  archive.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of archive) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export type ImportZipResult =
  | {
      ok: true;
      name: string;
      entryFile: string | null;
      designSystemId: string | null;
      meta: Record<string, unknown>;
      files: Array<{ path: string; content: string }>;
    }
  | { ok: false; error: string };

/**
 * Parse a neos-project ZIP buffer into name + file payloads (not yet written).
 */
export async function parseProjectZipBuffer(buf: Buffer): Promise<ImportZipResult> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, error: 'Empty archive' };
  }
  if (buf.length > PROJECT_ZIP_MAX_BYTES) {
    return { ok: false, error: `Archive exceeds max size (${PROJECT_ZIP_MAX_BYTES} bytes)` };
  }

  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(buf);
  } catch {
    return { ok: false, error: 'Invalid ZIP archive' };
  }

  let manifest: ProjectZipManifest | null = null;
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of directory.files) {
    const name = entry.path.replace(/\\/g, '/');
    if (!name || name.endsWith('/')) continue;
    // Block path traversal and absolute paths
    if (name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      return { ok: false, error: 'Archive contains unsafe path' };
    }
    // Symlink type in zip
    if ((entry as { type?: string }).type === 'SymbolicLink') {
      return { ok: false, error: 'Archive contains symlink (blocked)' };
    }

    if (name === 'project.json') {
      try {
        const raw = await entry.buffer();
        const text = raw.toString('utf8');
        if (/\0/.test(text)) return { ok: false, error: 'Invalid project.json' };
        const parsed = JSON.parse(text) as ProjectZipManifest;
        if (parsed.format !== PROJECT_ZIP_FORMAT) {
          return { ok: false, error: 'Unsupported archive format (expected neos-project)' };
        }
        if (typeof parsed.project?.name !== 'string' || !parsed.project.name.trim()) {
          return { ok: false, error: 'project.json missing name' };
        }
        if (/[\0\r\n]/.test(parsed.project.name)) {
          return { ok: false, error: 'Invalid project name in archive' };
        }
        manifest = parsed;
      } catch {
        return { ok: false, error: 'Invalid project.json' };
      }
      continue;
    }

    if (name === 'README.md') continue;

    if (name.startsWith('files/')) {
      if (files.length >= PROJECT_ZIP_MAX_FILES) {
        return { ok: false, error: `Too many files (max ${PROJECT_ZIP_MAX_FILES})` };
      }
      const rel = name.slice('files/'.length);
      if (!rel || rel.includes('..') || rel.startsWith('/') || /[\0]/.test(rel)) {
        return { ok: false, error: 'Archive contains unsafe file path' };
      }
      try {
        const raw = await entry.buffer();
        if (raw.length > PROJECT_ZIP_MAX_ENTRY_CHARS) {
          return { ok: false, error: `File too large: ${rel}` };
        }
        const content = raw.toString('utf8');
        if (/\0/.test(content)) {
          return { ok: false, error: `Binary/null content not allowed: ${rel}` };
        }
        files.push({ path: rel, content });
      } catch {
        return { ok: false, error: `Failed to read ${rel}` };
      }
    }
  }

  if (!manifest) {
    return { ok: false, error: 'Missing project.json (not a neos-project archive)' };
  }

  let entryFile: string | null = null;
  if (typeof manifest.project.entryFile === 'string') {
    const ef = manifest.project.entryFile.trim().replace(/^\/+/, '');
    if (ef && !/[\0\r\n]/.test(ef) && !ef.includes('..') && ef.length <= 500) {
      entryFile = ef;
    }
  }

  let designSystemId: string | null = null;
  if (typeof manifest.project.designSystemId === 'string') {
    const ds = manifest.project.designSystemId.trim();
    if (ds && !/[\0\r\n]/.test(ds) && ds.length <= 100) {
      designSystemId = ds;
    }
  }

  return {
    ok: true,
    name: manifest.project.name.trim().slice(0, 200),
    entryFile,
    designSystemId,
    meta:
      manifest.project.meta && typeof manifest.project.meta === 'object' && !Array.isArray(manifest.project.meta)
        ? (manifest.project.meta as Record<string, unknown>)
        : {},
    files,
  };
}

/** Write imported files into an existing project workspace root. */
export function materializeImportedFiles(
  baseDir: string,
  files: Array<{ path: string; content: string }>,
): { written: number } {
  let written = 0;
  for (const f of files) {
    try {
      writeProjectFile(baseDir, f.path, f.content);
      written += 1;
    } catch (err) {
      if (err instanceof PathSandboxError) throw err;
      // skip individual failures
    }
  }
  return { written };
}

/** Safe download filename for project export. */
export function projectZipFilename(name: string): string {
  const safe = (name || 'project').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'project';
  return `${safe}.neos-project.zip`;
}
