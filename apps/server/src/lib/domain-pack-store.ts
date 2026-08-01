/**
 * Domain Pack install store — local dir / ZIP under data dir (Task 15).
 *
 * Layout:
 *   $NEOS_DATA_DIR/domain-packs/<packId>/
 *     pack.json
 *     state.json   { "enabled": true }
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import unzipper from 'unzipper';
import {
  PACK_MANIFEST_FILENAMES,
  parsePackManifest,
  registerPackFromManifest,
  unregisterPack,
  setPackEnabled,
  isBuiltInPackId,
  isSafePackId,
  listPacks,
  type ParsedPackManifest,
} from '@neos-work/workflow-engine';
import { resolveDbDir } from '../db/schema.js';

export const DOMAIN_PACK_ZIP_MAX_BYTES = 10 * 1024 * 1024;
export const DOMAIN_PACK_ZIP_MAX_FILES = 100;
export const DOMAIN_PACK_MANIFEST_MAX_CHARS = 500_000;

/**
 * Normalize + validate a pack id used for on-disk paths under domain-packs/.
 * Rejects traversal (`..`, slashes) — safeRouteId alone is not sufficient.
 */
function normalizeInstalledPackId(packId: string): string | null {
  if (typeof packId !== 'string' || /[\0\r\n]/.test(packId)) return null;
  const id = packId.trim().toLowerCase();
  if (!id || !isSafePackId(id)) return null;
  return id;
}

/**
 * Resolve installed pack directory; ensure it stays under domain-packs root.
 */
function resolveInstalledPackDir(packId: string): string | null {
  const id = normalizeInstalledPackId(packId);
  if (!id) return null;
  const root = path.resolve(resolveDomainPacksDir());
  const dir = path.resolve(root, id);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (dir !== root && !dir.startsWith(rootPrefix)) return null;
  // Single segment only (id is slug; belt-and-suspenders vs path.resolve quirks)
  if (path.basename(dir) !== id) return null;
  return dir;
}

export function resolveDomainPacksDir(): string {
  const raw = process.env.NEOS_DATA_DIR;
  if (typeof raw === 'string' && !/[\0\r\n]/.test(raw) && raw.trim()) {
    return path.join(path.resolve(raw.trim()), 'domain-packs');
  }
  // Prefer same root as DB
  try {
    return path.join(resolveDbDir(), 'domain-packs');
  } catch {
    return path.join(os.homedir(), '.neos-work', 'domain-packs');
  }
}

export interface PackState {
  enabled: boolean;
}

async function readState(packDir: string): Promise<PackState> {
  const statePath = path.join(packDir, 'state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    if (/\0/.test(raw)) return { enabled: true };
    const j = JSON.parse(raw) as { enabled?: unknown };
    return { enabled: j.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

async function writeState(packDir: string, state: PackState): Promise<void> {
  await fs.writeFile(
    path.join(packDir, 'state.json'),
    JSON.stringify({ enabled: state.enabled }, null, 2),
    'utf8',
  );
}

async function findManifestPath(dir: string): Promise<string | null> {
  for (const name of PACK_MANIFEST_FILENAMES) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function readPackManifestFromDir(
  dirPath: string,
): Promise<{ ok: true; manifest: ParsedPackManifest; path: string } | { ok: false; error: string }> {
  if (typeof dirPath !== 'string' || !dirPath.trim() || /[\0\r\n]/.test(dirPath)) {
    return { ok: false, error: 'invalid directory path' };
  }
  const resolved = path.resolve(dirPath.trim());
  let st;
  try {
    st = await fs.stat(resolved);
  } catch {
    return { ok: false, error: 'directory not found' };
  }
  if (!st.isDirectory()) return { ok: false, error: 'path is not a directory' };

  const manifestPath = await findManifestPath(resolved);
  if (!manifestPath) {
    return {
      ok: false,
      error: `missing pack.json (or neos-pack.json) in ${path.basename(resolved)}`,
    };
  }

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return { ok: false, error: 'failed to read pack manifest' };
  }
  if (raw.length > DOMAIN_PACK_MANIFEST_MAX_CHARS) {
    return { ok: false, error: 'manifest too large' };
  }
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, manifest: parsed.manifest, path: manifestPath };
}

/**
 * Copy pack directory into data dir and register. Overwrites same pack id.
 */
export async function installPackFromDir(
  sourceDir: string,
): Promise<
  | { ok: true; packId: string; enabled: boolean }
  | { ok: false; error: string }
> {
  const read = await readPackManifestFromDir(sourceDir);
  if (!read.ok) return read;
  if (isBuiltInPackId(read.manifest.id)) {
    return { ok: false, error: `id "${read.manifest.id}" is reserved` };
  }

  const destRoot = resolveDomainPacksDir();
  const destDir = resolveInstalledPackDir(read.manifest.id);
  if (!destDir) {
    return { ok: false, error: 'invalid pack id' };
  }
  await fs.mkdir(destRoot, { recursive: true });

  // Replace existing install of same id
  if (existsSync(destDir)) {
    await fs.rm(destDir, { recursive: true, force: true });
  }
  await fs.mkdir(destDir, { recursive: true });

  // Copy only pack.json (+ optional README) — no arbitrary code execution
  const manifestName = path.basename(read.path);
  await fs.copyFile(read.path, path.join(destDir, manifestName));
  // Prefer pack.json name if source used neos-pack.json
  if (manifestName !== 'pack.json') {
    await fs.copyFile(read.path, path.join(destDir, 'pack.json'));
  }

  const state: PackState = { enabled: true };
  await writeState(destDir, state);

  unregisterPack(read.manifest.id);
  const reg = registerPackFromManifest(read.manifest, {
    enabled: true,
    sourcePath: destDir,
  });
  if (!reg.ok) return { ok: false, error: reg.error };
  return { ok: true, packId: read.manifest.id, enabled: true };
}

/**
 * Extract ZIP (must contain pack.json at root or single top-level folder) and install.
 */
export async function installPackFromZipBuffer(
  buf: Buffer,
): Promise<
  | { ok: true; packId: string; enabled: boolean }
  | { ok: false; error: string }
> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, error: 'empty zip' };
  }
  if (buf.length > DOMAIN_PACK_ZIP_MAX_BYTES) {
    return { ok: false, error: `zip exceeds max ${DOMAIN_PACK_ZIP_MAX_BYTES} bytes` };
  }

  let directory: unzipper.CentralDirectory;
  try {
    directory = await unzipper.Open.buffer(buf);
  } catch {
    return { ok: false, error: 'invalid zip archive' };
  }

  const files = directory.files.filter((f) => f.type === 'File');
  if (files.length === 0) return { ok: false, error: 'zip has no files' };
  if (files.length > DOMAIN_PACK_ZIP_MAX_FILES) {
    return { ok: false, error: `zip exceeds max ${DOMAIN_PACK_ZIP_MAX_FILES} files` };
  }

  // Reject path traversal / absolute / Windows drive / control chars
  for (const f of files) {
    const n = f.path.replace(/\\/g, '/');
    if (
      !n
      || n.startsWith('/')
      || n.includes('..')
      || /[\0\r\n]/.test(n)
      || /^[a-zA-Z]:/.test(n) // Windows absolute
      || n.includes(':') // scheme-like or alternate streams
    ) {
      return { ok: false, error: `unsafe zip entry: ${n.slice(0, 80)}` };
    }
  }

  // Find manifest entry
  const manifestEntry =
    files.find((f) => {
      const base = path.posix.basename(f.path.replace(/\\/g, '/'));
      return (PACK_MANIFEST_FILENAMES as readonly string[]).includes(base);
    }) ?? null;
  if (!manifestEntry) {
    return { ok: false, error: 'zip missing pack.json / neos-pack.json' };
  }

  let manifestRaw: string;
  try {
    const content = await manifestEntry.buffer();
    if (content.length > DOMAIN_PACK_MANIFEST_MAX_CHARS) {
      return { ok: false, error: 'manifest too large' };
    }
    manifestRaw = content.toString('utf8');
  } catch {
    return { ok: false, error: 'failed to read pack manifest from zip' };
  }

  const parsed = parsePackManifest(manifestRaw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (isBuiltInPackId(parsed.manifest.id)) {
    return { ok: false, error: `id "${parsed.manifest.id}" is reserved` };
  }

  // Manifest directory prefix ('' if at root)
  const manifestPosix = manifestEntry.path.replace(/\\/g, '/');
  const prefix = manifestPosix.includes('/')
    ? manifestPosix.slice(0, manifestPosix.lastIndexOf('/') + 1)
    : '';

  const destRoot = resolveDomainPacksDir();
  const destDir = resolveInstalledPackDir(parsed.manifest.id);
  if (!destDir) {
    return { ok: false, error: 'invalid pack id' };
  }
  await fs.mkdir(destRoot, { recursive: true });
  if (existsSync(destDir)) {
    await fs.rm(destDir, { recursive: true, force: true });
  }
  await fs.mkdir(destDir, { recursive: true });

  // Extract only safe text files under prefix (manifest + optional readme/docs)
  let extracted = 0;
  for (const f of files) {
    const posix = f.path.replace(/\\/g, '/');
    if (prefix && !posix.startsWith(prefix)) continue;
    const rel = prefix ? posix.slice(prefix.length) : posix;
    if (!rel || rel.includes('..') || rel.startsWith('/')) continue;
    // Only extract shallow files (no nested code execution surface)
    if (rel.includes('/')) continue;
    if (!/\.(json|md|txt)$/i.test(rel) && rel !== 'pack.json' && rel !== 'neos-pack.json') {
      continue;
    }
    try {
      const content = await f.buffer();
      if (content.length > DOMAIN_PACK_MANIFEST_MAX_CHARS) continue;
      if (content.includes(0)) continue; // binary null
      await fs.writeFile(path.join(destDir, path.basename(rel)), content);
      extracted += 1;
    } catch {
      // skip
    }
  }
  if (extracted === 0) {
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: 'failed to extract pack files' };
  }

  // Ensure pack.json exists
  if (!existsSync(path.join(destDir, 'pack.json'))) {
    await fs.writeFile(
      path.join(destDir, 'pack.json'),
      JSON.stringify(parsed.manifest, null, 2),
      'utf8',
    );
  }

  await writeState(destDir, { enabled: true });
  unregisterPack(parsed.manifest.id);
  const reg = registerPackFromManifest(parsed.manifest, {
    enabled: true,
    sourcePath: destDir,
  });
  if (!reg.ok) return { ok: false, error: reg.error };
  return { ok: true, packId: parsed.manifest.id, enabled: true };
}

/**
 * Scan installed packs under data dir and register into runtime.
 */
export async function loadInstalledDomainPacks(): Promise<{ loaded: number; errors: string[] }> {
  const root = resolveDomainPacksDir();
  const errors: string[] = [];
  let loaded = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { loaded: 0, errors: [] };
  }

  for (const name of entries) {
    if (!name || name.startsWith('.') || /[\0\r\n]/.test(name)) continue;
    // Only slug directory names — skip traversal-like or non-pack entries
    if (!isSafePackId(name)) {
      errors.push(`${name}: skipped (invalid pack directory name)`);
      continue;
    }
    const dir = resolveInstalledPackDir(name);
    if (!dir) continue;
    let st;
    try {
      // lstat: do not follow planted pack-dir symlinks outside data root
      st = await fs.lstat(dir);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) continue;

    const read = await readPackManifestFromDir(dir);
    if (!read.ok) {
      errors.push(`${name}: ${read.error}`);
      continue;
    }
    // Directory name should match id (best-effort)
    if (read.manifest.id !== name) {
      errors.push(`${name}: pack id "${read.manifest.id}" does not match directory`);
      // still load under manifest id
    }
    const state = await readState(dir);
    unregisterPack(read.manifest.id);
    const reg = registerPackFromManifest(read.manifest, {
      enabled: state.enabled,
      sourcePath: dir,
    });
    if (!reg.ok) {
      errors.push(`${name}: ${reg.error}`);
      continue;
    }
    loaded += 1;
  }
  return { loaded, errors };
}

export async function setInstalledPackEnabled(
  packId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const id = normalizeInstalledPackId(packId);
  if (!id) {
    return { ok: false, error: 'invalid pack id', status: 400 };
  }
  if (isBuiltInPackId(id)) {
    return { ok: false, error: 'cannot toggle a built-in pack', status: 400 };
  }
  const dir = resolveInstalledPackDir(id);
  if (!dir) {
    return { ok: false, error: 'invalid pack id', status: 400 };
  }
  if (!existsSync(dir)) {
    return { ok: false, error: 'pack not installed', status: 404 };
  }
  await writeState(dir, { enabled });
  // Ensure runtime has definition (may only be disabled shell)
  const existing = listPacks().find((p) => p.id === id);
  if (!existing) {
    const read = await readPackManifestFromDir(dir);
    if (!read.ok) return { ok: false, error: read.error, status: 500 };
    const reg = registerPackFromManifest(read.manifest, {
      enabled,
      sourcePath: dir,
    });
    if (!reg.ok) return { ok: false, error: reg.error, status: 500 };
    return { ok: true };
  }
  const r = setPackEnabled(id, enabled);
  if (!r.ok) return { ok: false, error: r.error, status: 400 };
  return { ok: true };
}

export async function uninstallInstalledPack(
  packId: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const id = normalizeInstalledPackId(packId);
  if (!id) {
    return { ok: false, error: 'invalid pack id', status: 400 };
  }
  if (isBuiltInPackId(id)) {
    return { ok: false, error: 'cannot uninstall a built-in pack', status: 400 };
  }
  const dir = resolveInstalledPackDir(id);
  if (!dir) {
    return { ok: false, error: 'invalid pack id', status: 400 };
  }
  unregisterPack(id);
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { ok: true };
}
