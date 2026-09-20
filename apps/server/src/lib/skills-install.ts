/** Remote skill ingest: snapshot, zipball, well-known, or direct SKILL.md. */

import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyOccupancy,
  discoverSkills,
  isPathInside,
  parseSkillFile,
  resolveBundledSkillsDir,
  resolveUserSkillsDir,
  resolveWorkspaceSkillsDir,
  sanitizeSkillDirName,
  writeSkillProvenance,
  readSkillProvenance,
} from '@neos-work/core';
import { NEOS_VERSION, type SkillProvenance } from '@neos-work/shared';

import { getDb } from '../db/schema.js';
import { getSetting } from '../db/settings.js';
import * as sessionsDb from '../db/sessions.js';
import { publicPathTail } from './path-safety.js';
import {
  getSkillsCatalogFetchImpl,
  isRemoteInstallEnabled,
  resolveSkillFiles,
  type FetchPath,
  type SkillSnapshot,
} from './skills-catalog.js';
import { fetchPublicHttp } from './ssrf.js';
import {
  discoverSkillFolders,
  parseInstallSource,
  pickSkillFolder,
  SkillsHttpError,
  type InstallSource,
  type ParseInstallSourceInput,
  type SkillFileBlob,
} from './skills-source.js';

const ROOT_WHITELIST_TOP = new Set(['skill.md', 'references', 'assets', 'scripts', 'examples']);

const TELEMETRY_URL = 'https://add-skill.vercel.sh/t';
const TELEMETRY_TIMEOUT_MS = 2_000;
const TELEMETRY_QUERY_ALLOWLIST = new Set(['event', 'source', 'skills', 'v']);

function resolvedRemoteId(src: InstallSource, candSlug: string): string {
  const slug = src.slug ?? candSlug;
  if (src.kind === 'github' && src.owner && src.repo) {
    return `${src.owner}/${src.repo}/${slug}`;
  }
  return src.id ?? `${src.owner}/${src.repo}/${slug}`;
}

function telemetrySource(src: InstallSource): string {
  if (src.kind === 'github' && src.owner && src.repo) return `${src.owner}/${src.repo}`;
  if (typeof src.url === 'string' && src.url.trim()) return src.url.trim();
  if (typeof src.id === 'string' && src.id.trim()) return src.id.trim();
  return '';
}

function buildTelemetryUrl(source: string, slug: string): string {
  const u = new URL(TELEMETRY_URL);
  u.searchParams.set('event', 'install');
  u.searchParams.set('source', source);
  u.searchParams.set('skills', slug);
  u.searchParams.set('v', NEOS_VERSION);
  for (const key of [...u.searchParams.keys()]) {
    if (!TELEMETRY_QUERY_ALLOWLIST.has(key)) u.searchParams.delete(key);
  }
  return u.href;
}

/** Appendix E: opt-in fire-and-forget GET. Failures never block install. */
function maybeSendInstallTelemetry(src: InstallSource, slug: string): void {
  try {
    if (getSetting('skills.telemetryOptIn') !== 'true') return;
    const source = telemetrySource(src);
    if (!source || !slug) return;
    const url = buildTelemetryUrl(source, slug);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
    const fetchImpl = getSkillsCatalogFetchImpl();
    void fetchPublicHttp(url, {
      method: 'GET',
      headers: { 'User-Agent': `neos-work-skills/${NEOS_VERSION}` },
      signal: controller.signal,
      checkDns: !fetchImpl,
      followOneRedirect: true,
      fetchImpl,
    }).catch(() => {
      /* swallow */
    }).finally(() => {
      clearTimeout(timer);
    });
  } catch {
    /* swallow */
  }
}

type RenameFn = (from: string, to: string) => Promise<unknown>;
let renameFn: RenameFn = (from, to) => fsp.rename(from, to);

/** Test seam for bak restore when rename(tmp → final) fails. */
export function setSkillsRenameForTests(fn?: RenameFn): void {
  renameFn = fn ?? ((from, to) => fsp.rename(from, to));
}

export type SkillUpsertFn = (params: {
  name: string;
  description?: string;
  source: string;
  path: string;
  version?: string;
  manifestJson?: string;
}) => { id: string; name: string; version: string | null; path: string; enabled: number; installed_at: string };

export type InstallRemoteInput = ParseInstallSourceInput & {
  scope?: unknown;
  confirm?: unknown;
  includeInternal?: unknown;
};

export type InstallRemoteResult = {
  id: string;
  name: string;
  source: 'remote';
  version: string | null;
  hash: string | null;
  scope: 'global' | 'workspace';
  path: string;
  fetchPath: FetchPath;
  shadowed?: 'bundled';
  unchanged?: boolean;
};

type SkillNameRow = {
  id: string;
  name: string;
  source: string;
  path: string;
  enabled: number;
  installed_at: string;
  manifest_json: string | null;
};

function findSkillByName(name: string): SkillNameRow | undefined {
  return getDb()
    .prepare('SELECT id, name, source, path, enabled, installed_at, manifest_json FROM skill WHERE name = ?')
    .get(name) as SkillNameRow | undefined;
}

function findSkillById(id: string): SkillNameRow | undefined {
  return getDb()
    .prepare('SELECT id, name, source, path, enabled, installed_at, manifest_json FROM skill WHERE id = ?')
    .get(id) as SkillNameRow | undefined;
}

function defaultScope(): 'global' | 'workspace' {
  const v = getSetting('skills.defaultInstallScope');
  return v?.trim() === 'workspace' ? 'workspace' : 'global';
}

function resolveScope(raw: unknown): 'global' | 'workspace' {
  if (raw === 'workspace' || raw === 'global') return raw;
  return defaultScope();
}

function resolveInstallRoot(scope: 'global' | 'workspace'): string {
  if (scope === 'workspace') {
    const ws = sessionsDb.listWorkspaces()[0];
    const path = typeof ws?.path === 'string' ? ws.path.trim() : '';
    if (!path || /[\0\r\n]/.test(path)) {
      throw new SkillsHttpError(400, 'no_workspace_path');
    }
    return resolveWorkspaceSkillsDir(path);
  }
  return resolveUserSkillsDir();
}

async function pathHasEscapingSymlink(root: string, target: string): Promise<boolean> {
  if (!isPathInside(root, target)) return true;
  let cur = resolve(target);
  const stop = resolve(root);
  for (let i = 0; i < 64; i++) {
    try {
      const st = await fsp.lstat(cur);
      if (st.isSymbolicLink()) {
        try {
          const real = realpathSync(cur);
          if (!isPathInside(root, real)) return true;
        } catch {
          return true;
        }
      }
    } catch {
      // missing — still walk parents
    }
    if (cur === stop) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

const ALLOWED_CONTENT_ROOTS = (): string[] => {
  const roots = [resolveUserSkillsDir()];
  const ws = sessionsDb.listWorkspaces()[0];
  if (typeof ws?.path === 'string' && ws.path.trim() && !/[\0\r\n]/.test(ws.path)) {
    roots.push(resolveWorkspaceSkillsDir(ws.path.trim()));
  }
  return roots;
};

async function assertReadableSkillFile(absPath: string): Promise<string | null> {
  if (typeof absPath !== 'string' || /[\0\r\n]/.test(absPath) || !absPath.trim()) return null;
  const target = resolve(absPath.trim());
  const roots = ALLOWED_CONTENT_ROOTS();
  let root: string | null = null;
  for (const r of roots) {
    if (isPathInside(r, target)) {
      root = r;
      break;
    }
  }
  if (!root) return null;
  if (await pathHasEscapingSymlink(root, target)) return null;
  try {
    const st = await fsp.lstat(target);
    if (st.isSymbolicLink() || !st.isFile()) return null;
  } catch {
    return null;
  }
  return target;
}

function applyRootWhitelist(files: SkillFileBlob[], isRepoRoot: boolean): SkillFileBlob[] {
  if (!isRepoRoot) return files;
  return files.filter((f) => {
    const top = (f.path.split('/')[0] ?? '').toLowerCase();
    return ROOT_WHITELIST_TOP.has(top);
  });
}

function parseNameConflictProvenance(manifestJson: string | null): string | null {
  if (!manifestJson) return null;
  try {
    const m = JSON.parse(manifestJson) as { provenance?: { id?: unknown } };
    return typeof m.provenance?.id === 'string' ? m.provenance.id : null;
  } catch {
    return null;
  }
}

function isCrystallizeMarkdown(content: string): boolean {
  return /^source:\s*crystallize\s*$/m.test(content);
}

async function classifyInstallOccupancy(
  dir: string,
  expectedRemoteId: string,
): Promise<
  | 'empty'
  | 'orphan'
  | 'same_remote'
  | 'occupied_remote'
  | 'occupied_skill'
  | 'occupied_plugin'
  | 'occupied_crystallize'
  | 'occupied_unknown'
> {
  const occ = await classifyOccupancy(dir, expectedRemoteId);
  if (occ === 'occupied_skill' || occ === 'occupied_unknown') {
    try {
      const md = await fsp.readFile(join(dir, 'SKILL.md'), 'utf8');
      if (isCrystallizeMarkdown(md)) return 'occupied_crystallize';
    } catch {
      /* no skill md */
    }
  }
  return occ;
}

async function writeTree(tmp: string, files: SkillFileBlob[], root: string): Promise<void> {
  if (!isPathInside(root, tmp)) throw new SkillsHttpError(502, 'ssrf_blocked');
  await fsp.mkdir(tmp, { recursive: true });
  for (const file of files) {
    const dest = resolve(tmp, file.path);
    if (!isPathInside(tmp, dest) || !isPathInside(root, dest)) {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    await fsp.mkdir(dirname(dest), { recursive: true });
    try {
      const st = await fsp.lstat(dest);
      if (st.isSymbolicLink()) throw new SkillsHttpError(502, 'invalid_upstream');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (typeof file.contents === 'string') {
      await fsp.writeFile(dest, file.contents, 'utf8');
    } else {
      await fsp.writeFile(dest, file.contents);
    }
  }
}

async function copyPluginManifest(finalDir: string, tmp: string, root: string): Promise<void> {
  const src = join(finalDir, 'open-design.json');
  const dest = join(tmp, 'open-design.json');
  if (!isPathInside(finalDir, src) || !isPathInside(tmp, dest) || !isPathInside(root, dest)) return;
  try {
    const st = await fsp.lstat(src);
    if (st.isSymbolicLink() || !st.isFile()) return;
    await fsp.writeFile(dest, await fsp.readFile(src));
  } catch {
    // no plugin marker
  }
}

async function atomicReplace(
  root: string,
  tmp: string,
  finalDir: string,
  bak: string,
  commit: () => void,
): Promise<void> {
  for (const p of [tmp, finalDir, bak]) {
    if (!isPathInside(root, p)) throw new SkillsHttpError(502, 'ssrf_blocked');
  }
  let movedAside = false;
  try {
    if (existsSync(finalDir)) {
      await renameFn(finalDir, bak);
      movedAside = true;
    }
    await renameFn(tmp, finalDir);
    try {
      commit();
    } catch (err) {
      await fsp.rm(finalDir, { recursive: true, force: true }).catch(() => {});
      if (movedAside) await renameFn(bak, finalDir).catch(() => {});
      throw err;
    }
    if (movedAside) await fsp.rm(bak, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    if (movedAside && !existsSync(finalDir)) {
      await renameFn(bak, finalDir).catch(() => {});
    }
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function selectFilesForPackage(cand: { relDir: string; files: SkillFileBlob[] }): SkillFileBlob[] {
  const isRepoRoot = cand.relDir === '' && cand.files.some((f) => f.path === 'SKILL.md');
  const filtered = applyRootWhitelist(cand.files, isRepoRoot);
  const hasSkill = filtered.some((f) => f.path === 'SKILL.md');
  return hasSkill ? filtered : cand.files;
}

const STALE_TMP_MS = 24 * 60 * 60 * 1000;

async function cleanupStaleInstallDirs(root: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith('.tmp-') && !name.startsWith('.bak-')) continue;
    const p = resolve(root, name);
    if (!isPathInside(root, p)) continue;
    try {
      const st = await fsp.lstat(p);
      if (now - st.mtimeMs < STALE_TMP_MS) continue;
      await fsp.rm(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function provenanceOrigin(fetchPath: FetchPath, src: InstallSource): SkillProvenance['origin'] {
  if (fetchPath === 'snapshot') return 'skills.sh';
  if (src.kind === 'github' || fetchPath === 'zipball') return 'github';
  return 'well-known';
}

function detectInstallScope(packageDir: string): 'global' | 'workspace' {
  if (isPathInside(resolveUserSkillsDir(), packageDir)) return 'global';
  const ws = sessionsDb.listWorkspaces()[0];
  if (typeof ws?.path === 'string' && ws.path.trim() && !/[\0\r\n]/.test(ws.path)) {
    if (isPathInside(resolveWorkspaceSkillsDir(ws.path.trim()), packageDir)) return 'workspace';
  }
  return 'global';
}

async function ingestSnapshot(opts: {
  src: InstallSource;
  snap: SkillSnapshot;
  scope: 'global' | 'workspace';
  includeInternal: boolean;
  upsert: SkillUpsertFn;
  existingSidecar?: SkillProvenance | null;
  pinDir?: string;
}): Promise<InstallRemoteResult> {
  const { src, snap, scope, includeInternal, upsert } = opts;
  const fetchPath = snap.fetchPath;
  const cands = discoverSkillFolders(snap.files, src.slug ?? snap.slug);
  const cand = pickSkillFolder(cands, src.slug);
  const parsed = parseSkillFile(cand.skillMd, 'SKILL.md', 'remote');
  if (!parsed) throw new SkillsHttpError(404, 'no_skills');
  if (parsed.manifest.metadata?.internal === 'true' && !includeInternal) {
    throw new SkillsHttpError(404, 'no_skills');
  }

  const name = parsed.manifest.name;
  const remoteId = resolvedRemoteId(src, cand.slug);
  if (src.kind === 'github') src.id = remoteId;
  const existing = findSkillByName(name);
  let shadowed: 'bundled' | undefined;
  if (existing) {
    const existingRemoteId = parseNameConflictProvenance(existing.manifest_json);
    if (existingRemoteId && existingRemoteId !== remoteId) {
      throw new SkillsHttpError(409, 'name_conflict');
    }
    if (!existingRemoteId) {
      if (existing.source === 'bundled') {
        shadowed = 'bundled';
      } else {
        throw new SkillsHttpError(409, 'name_conflict');
      }
    }
  }

  const root = resolveInstallRoot(scope);
  await fsp.mkdir(root, { recursive: true });
  await cleanupStaleInstallDirs(root);

  if (existing && existing.source !== 'bundled' && !isPathInside(root, existing.path)) {
    throw new SkillsHttpError(409, 'name_conflict');
  }

  let dirName = sanitizeSkillDirName(parsed.manifest.name || cand.slug);
  if (!dirName) throw new SkillsHttpError(400, 'invalid_source');

  let finalDir = opts.pinDir ? resolve(opts.pinDir) : resolve(root, dirName);
  if (!isPathInside(root, finalDir)) throw new SkillsHttpError(400, 'invalid_source');

  let occ = await classifyInstallOccupancy(finalDir, remoteId);
  if (!opts.pinDir && occ === 'occupied_remote') {
    const retry = `${sanitizeSkillDirName(`${src.owner}/${src.repo}`)}--${sanitizeSkillDirName(cand.slug)}`;
    if (retry && retry !== dirName) {
      dirName = retry;
      finalDir = resolve(root, dirName);
      if (!isPathInside(root, finalDir)) throw new SkillsHttpError(400, 'invalid_source');
      occ = await classifyInstallOccupancy(finalDir, remoteId);
    }
  }
  if (
    occ === 'occupied_remote'
    || occ === 'occupied_skill'
    || occ === 'occupied_plugin'
    || occ === 'occupied_crystallize'
    || occ === 'occupied_unknown'
  ) {
    console.log(`skills-install-denied reason=occupancy`);
    throw new SkillsHttpError(409, occ);
  }

  const files = selectFilesForPackage(cand);
  const now = new Date().toISOString();
  const provenance: SkillProvenance = {
    schemaVersion: 'neos-skill-source/v1',
    origin: provenanceOrigin(fetchPath, src),
    id: remoteId,
    source: src.kind === 'github' && src.owner && src.repo ? `${src.owner}/${src.repo}` : remoteId,
    slug: src.slug ?? cand.slug,
    trust: 'unverified',
    installedAt: opts.existingSidecar?.installedAt ?? now,
    updatedAt: now,
  };
  if (src.kind === 'github' && src.owner && src.repo) {
    provenance.installUrl = `https://github.com/${src.owner}/${src.repo}`;
  } else if (src.url) {
    provenance.installUrl = src.url;
  }
  if (src.ref) provenance.ref = src.ref;
  if (snap.hash) provenance.hash = snap.hash;

  const tmp = resolve(root, `.tmp-${randomUUID()}`);
  const bak = resolve(root, `.bak-${randomUUID()}`);
  const started = Date.now();

  await writeTree(tmp, files, root);
  await writeSkillProvenance(tmp, provenance);
  if (existsSync(finalDir)) await copyPluginManifest(finalDir, tmp, root);

  const skillMdPath = join(tmp, 'SKILL.md');
  const written = parseSkillFile(await fsp.readFile(skillMdPath, 'utf8'), skillMdPath, 'remote');
  if (!written) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw new SkillsHttpError(404, 'no_skills');
  }

  const finalSkillMd = join(finalDir, 'SKILL.md');
  let row!: ReturnType<SkillUpsertFn>;
  await atomicReplace(root, tmp, finalDir, bak, () => {
    const manifest = {
      ...written.manifest,
      featured: false,
      provenance,
      packageDir: finalDir,
    };
    row = upsert({
      name: written.manifest.name,
      description: written.manifest.description,
      source: 'remote',
      path: finalSkillMd,
      version: written.manifest.version ?? written.manifest.metadata?.version,
      manifestJson: JSON.stringify(manifest),
    });
  });

  const ms = Date.now() - started;
  console.log(
    `skills-install id=${remoteId} origin=${provenance.origin} fetchPath=${fetchPath} files=${files.length} ms=${ms}${shadowed ? ' shadowed=bundled' : ''}`,
  );

  const result: InstallRemoteResult = {
    id: row.id,
    name: row.name,
    source: 'remote',
    version: row.version,
    hash: snap.hash,
    scope,
    path: publicPathTail(finalSkillMd),
    fetchPath,
  };
  if (shadowed) result.shadowed = shadowed;
  maybeSendInstallTelemetry(src, src.slug ?? cand.slug);
  return result;
}

export async function installRemoteSkill(
  input: InstallRemoteInput,
  opts: { upsert: SkillUpsertFn },
): Promise<InstallRemoteResult> {
  if (input.confirm !== true) throw new SkillsHttpError(400, 'confirm_required');
  if (!isRemoteInstallEnabled()) throw new SkillsHttpError(403, 'install_disabled');

  const src = parseInstallSource(input);
  const scope = resolveScope(input.scope);
  const snap = await resolveSkillFiles(src, { preview: false });
  return ingestSnapshot({
    src,
    snap,
    scope,
    includeInternal: input.includeInternal === true,
    upsert: opts.upsert,
  });
}

export async function updateRemoteSkill(
  skillId: string,
  opts: { upsert: SkillUpsertFn },
): Promise<InstallRemoteResult> {
  if (!isRemoteInstallEnabled()) throw new SkillsHttpError(403, 'install_disabled');
  const row = findSkillById(skillId);
  if (!row) throw new SkillsHttpError(404, 'not_found');

  const packageDir = dirname(resolve(row.path));
  const sidecar = await readSkillProvenance(packageDir);
  if (!sidecar) throw new SkillsHttpError(400, 'not_remote');

  const scope = detectInstallScope(packageDir);

  let src: InstallSource;
  try {
    src = parseInstallSource({
      id: sidecar.id,
      url: sidecar.installUrl,
      ref: sidecar.ref,
      slug: sidecar.slug,
    });
  } catch {
    throw new SkillsHttpError(400, 'invalid_source');
  }

  const snap = await resolveSkillFiles(src, { preview: false });
  if (sidecar.hash && snap.hash && sidecar.hash === snap.hash) {
    return {
      id: row.id,
      name: row.name,
      source: 'remote',
      version: null,
      hash: sidecar.hash,
      scope,
      path: publicPathTail(row.path),
      fetchPath: snap.fetchPath,
      unchanged: true,
    };
  }

  return ingestSnapshot({
    src,
    snap,
    scope,
    includeInternal: true,
    upsert: opts.upsert,
    existingSidecar: sidecar,
    pinDir: packageDir,
  });
}

/**
 * Drop remote rows whose SKILL.md is missing inside the current data root.
 * Paths outside the current root are left alone (NEOS_DATA_DIR move).
 * Returns names that must not be overwritten by a later bundled/local upsert.
 */
export async function pruneMissingRemoteSkills(): Promise<Set<string>> {
  const roots = ALLOWED_CONTENT_ROOTS();
  const keepNames = new Set<string>();
  type Row = { id: string; name: string; source: string; path: string };
  let rows: Row[] = [];
  try {
    rows = getDb()
      .prepare("SELECT id, name, source, path FROM skill WHERE source = 'remote'")
      .all() as Row[];
  } catch {
    return keepNames;
  }

  for (const row of rows) {
    if (row.source !== 'remote') continue;
    const abs = resolve(row.path);
    if (!roots.some((r) => isPathInside(r, abs))) {
      keepNames.add(row.name.toLowerCase());
      continue;
    }
    const packageDir = dirname(abs);
    if (!roots.some((r) => isPathInside(r, packageDir))) {
      keepNames.add(row.name.toLowerCase());
      continue;
    }
    const sidecar = await readSkillProvenance(packageDir);
    if (!sidecar) continue;
    let missing = false;
    try {
      const st = await fsp.lstat(abs);
      missing = st.isSymbolicLink() || !st.isFile();
    } catch {
      missing = true;
    }
    if (!missing) continue;
    getDb().prepare('DELETE FROM skill WHERE id = ?').run(row.id);
  }
  return keepNames;
}

export type DeleteInstalledSkillResult = {
  filesRemoved: boolean;
  restored?: 'bundled' | 'local';
};

/** Monorepo `skills/` from apps/server/src/lib. */
const REPO_SKILLS_CANDIDATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../skills',
);

async function canRemoveRemotePackage(
  row: SkillNameRow,
  packageDir: string,
): Promise<{ root: string } | null> {
  if (row.source !== 'remote') return null;
  const sidecar = await readSkillProvenance(packageDir);
  if (!sidecar) return null;
  const roots = ALLOWED_CONTENT_ROOTS();
  let root: string | null = null;
  for (const r of roots) {
    if (isPathInside(r, packageDir)) {
      root = r;
      break;
    }
  }
  if (!root) return null;
  if (await pathHasEscapingSymlink(root, packageDir)) return null;
  try {
    const st = await fsp.lstat(packageDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
  } catch {
    return null;
  }
  return { root };
}

async function restoreShadowedSkill(
  name: string,
  upsert: SkillUpsertFn,
): Promise<'bundled' | 'local' | undefined> {
  const want = name.trim().toLowerCase();
  if (!want) return undefined;
  const ws = sessionsDb.listWorkspaces()[0];
  const workspacePath =
    typeof ws?.path === 'string' && ws.path.trim() && !/[\0\r\n]/.test(ws.path)
      ? ws.path.trim()
      : undefined;
  const bundledRoot =
    resolveBundledSkillsDir(REPO_SKILLS_CANDIDATE) ?? resolveBundledSkillsDir(null);
  const found = await discoverSkills(workspacePath, {
    bundledRoot,
    includeBundled: true,
    includeGlobal: true,
  });
  const matches = found.filter((s) => s.manifest.name.toLowerCase() === want);
  const hit =
    matches.find((s) => s.source === 'bundled')
    ?? matches.find((s) => s.source === 'local');
  if (!hit || (hit.source !== 'bundled' && hit.source !== 'local')) return undefined;
  const sidecar = hit.packageDir ? await readSkillProvenance(hit.packageDir) : null;
  if (sidecar) return undefined;
  upsert({
    name: hit.manifest.name,
    description: hit.manifest.description,
    source: hit.source,
    path: hit.path,
    version: hit.manifest.version ?? hit.manifest.metadata?.version,
    manifestJson: JSON.stringify({
      ...hit.manifest,
      packageDir: hit.packageDir,
      examples: hit.examples,
      assets: hit.assets,
      references: hit.references,
    }),
  });
  return hit.source;
}

/**
 * DELETE /api/skills/:id — rm remote package only when source is remote,
 * sidecar is valid, packageDir is inside a skills root, and no ancestor
 * symlink escapes that root.
 */
export async function deleteInstalledSkill(
  skillId: string,
  opts: { upsert: SkillUpsertFn },
): Promise<DeleteInstalledSkillResult> {
  const row = findSkillById(skillId);
  if (!row) throw new SkillsHttpError(404, 'not_found');

  const packageDir = dirname(resolve(row.path));
  const removable = await canRemoveRemotePackage(row, packageDir);
  let filesRemoved = false;
  if (removable) {
    await fsp.rm(packageDir, { recursive: true, force: true });
    filesRemoved = true;
    try {
      const restored = await restoreShadowedSkill(row.name, opts.upsert);
      if (restored) return { filesRemoved: true, restored };
    } catch {
      // Row still points at a removed tree — drop it below.
    }
  }

  const deleted = getDb().prepare('DELETE FROM skill WHERE id = ?').run(row.id);
  if (deleted.changes === 0) throw new SkillsHttpError(404, 'not_found');
  return { filesRemoved };
}

const CONTENT_BODY_MAX = 32 * 1024;

export async function readSkillContent(absPath: string): Promise<{ body: string; truncated: boolean } | null> {
  const safe = await assertReadableSkillFile(absPath);
  if (!safe) return null;
  const buf = await fsp.readFile(safe);
  const truncated = buf.byteLength > CONTENT_BODY_MAX;
  const slice = truncated ? buf.subarray(0, CONTENT_BODY_MAX) : buf;
  return { body: slice.toString('utf8'), truncated };
}
