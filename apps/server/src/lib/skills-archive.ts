/** Zip extract + shared archive/snapshot path rules. */

import unzipper from 'unzipper';

import { SkillsHttpError } from './skills-source.js';

export const ZIPBALL_HTTP_MAX = 10 * 1024 * 1024;
export const ZIP_EXTRACT_MAX = 25 * 1024 * 1024;
export const ZIP_FILE_COUNT_MAX = 1_000;
export const TEXT_FILE_MAX = 1 * 1024 * 1024;
export const ASSET_FILE_MAX = 2 * 1024 * 1024;

export type ArchiveFile = { path: string; contents: Buffer };

function isAssetRelPath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/');
  return n === 'assets' || n.startsWith('assets/');
}

function fileSizeCap(rel: string): number {
  return isAssetRelPath(rel) ? ASSET_FILE_MAX : TEXT_FILE_MAX;
}

/** Path rules for zip entries and snapshot `files[].path`. */
export function classifyArchivePath(raw: unknown): 'ok' | 'skip' | 'reject' {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'reject';
  const n = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.length > 500) return 'reject';
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return 'reject';
  const segs = n.split('/');
  if (segs.some((s) => s === '..' || s === '.' || s === '')) return 'reject';
  if (/[\x00-\x1f]/.test(n)) return 'reject';
  const lowerSegs = segs.map((s) => s.toLowerCase());
  if (lowerSegs[0] === '__macosx' || lowerSegs.includes('.git') || lowerSegs.includes('node_modules')) {
    return 'skip';
  }
  return 'ok';
}

function normalizeArchiveRelPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isZipSymlink(entry: { externalFileAttributes?: number }): boolean {
  const attrs = entry.externalFileAttributes;
  if (typeof attrs !== 'number') return false;
  return ((attrs >>> 16) & 0o170000) === 0o120000;
}

function unwrapPrefix(paths: string[]): string {
  const tops = new Set<string>();
  for (const p of paths) {
    const top = p.split('/')[0];
    if (!top || top.toLowerCase() === '__macosx') continue;
    tops.add(top);
  }
  if (tops.size !== 1) return '';
  const only = [...tops][0]!;
  const hasChild = paths.some((p) => p.startsWith(`${only}/`));
  if (!hasChild) return '';
  const allUnder = paths.every((p) => {
    const top = p.split('/')[0]?.toLowerCase();
    return p === only || p.startsWith(`${only}/`) || top === '__macosx';
  });
  return allUnder ? only : '';
}

function entryType(entry: { type?: string }): string {
  return typeof entry.type === 'string' ? entry.type : 'File';
}

function listedSize(entry: { uncompressedSize?: number }): number {
  const n = entry.uncompressedSize;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * In-memory unzip. Rejects traversal / symlink / oversize. Unwraps a single top folder.
 */
export async function extractSkillZip(buf: Buffer): Promise<ArchiveFile[]> {
  if (!Buffer.isBuffer(buf) || buf.byteLength === 0) {
    throw new SkillsHttpError(502, 'invalid_upstream');
  }
  if (buf.byteLength > ZIPBALL_HTTP_MAX) {
    throw new SkillsHttpError(502, 'upstream_too_large');
  }

  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(buf);
  } catch {
    throw new SkillsHttpError(502, 'invalid_upstream');
  }

  const files: Array<{ path: string; entry: unzipper.File }> = [];
  let listedSum = 0;
  for (const entry of directory.files) {
    const type = entryType(entry);
    if (type === 'Directory' || entry.path.endsWith('/')) continue;
    if (type !== 'File' || isZipSymlink(entry as { externalFileAttributes?: number })) {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    const verdict = classifyArchivePath(entry.path);
    if (verdict === 'reject') throw new SkillsHttpError(502, 'invalid_upstream');
    if (verdict === 'skip') continue;
    const rel = normalizeArchiveRelPath(entry.path);
    listedSum += listedSize(entry);
    if (listedSum > ZIP_EXTRACT_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    files.push({ path: rel, entry });
    if (files.length > ZIP_FILE_COUNT_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
  }

  if (files.length === 0) throw new SkillsHttpError(404, 'no_skills');

  const prefix = unwrapPrefix(files.map((f) => f.path));
  const prefixSlash = prefix ? `${prefix}/` : '';

  const out: ArchiveFile[] = [];
  let actualSum = 0;
  for (const file of files) {
    let rel = file.path;
    if (prefixSlash) {
      if (rel === prefix) continue;
      if (!rel.startsWith(prefixSlash)) continue;
      rel = rel.slice(prefixSlash.length);
    }
    if (!rel) continue;
    const after = classifyArchivePath(rel);
    if (after === 'reject') throw new SkillsHttpError(502, 'invalid_upstream');
    if (after === 'skip') continue;

    let contents: Buffer;
    try {
      contents = await file.entry.buffer();
    } catch {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    if (!Buffer.isBuffer(contents)) contents = Buffer.from(contents);
    const cap = fileSizeCap(rel);
    if (contents.byteLength > cap) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    actualSum += contents.byteLength;
    if (actualSum > ZIP_EXTRACT_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    out.push({ path: rel, contents });
    if (out.length > ZIP_FILE_COUNT_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
  }

  if (out.length === 0) throw new SkillsHttpError(404, 'no_skills');
  return out;
}
