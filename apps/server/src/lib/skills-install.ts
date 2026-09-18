/** Snapshot-only remote skill ingest. */

import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  classifyOccupancy,
  isPathInside,
  parseSkillFile,
  resolveUserSkillsDir,
  resolveWorkspaceSkillsDir,
  sanitizeSkillDirName,
  writeSkillProvenance,
  readSkillProvenance,
} from '@neos-work/core';
import type { SkillProvenance } from '@neos-work/shared';

import { getDb } from '../db/schema.js';
import { getSetting } from '../db/settings.js';
import * as sessionsDb from '../db/sessions.js';
import { publicPathTail } from './path-safety.js';
import {
  fetchSkillSnapshot,
  isRemoteInstallEnabled,
  type SkillSnapshot,
  type SnapshotFile,
} from './skills-catalog.js';
import {
  parseInstallSource,
  SkillsHttpError,
  type InstallSource,
  type ParseInstallSourceInput,
} from './skills-source.js';

const ROOT_WHITELIST_TOP = new Set(['skill.md', 'references', 'assets', 'scripts', 'examples']);

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
  fetchPath: 'snapshot';
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

type SkillCandidate = {
  slug: string;
  name: string;
  files: SnapshotFile[];
  skillMd: string;
  relDir: string;
};

function discoverSnapshotSkills(files: SnapshotFile[], fallbackSlug: string): SkillCandidate[] {
  const skillMdFiles = files.filter((f) => {
    const base = f.path.split('/').pop() ?? '';
    return base === 'SKILL.md';
  });
  const out: SkillCandidate[] = [];
  for (const md of skillMdFiles) {
    const segs = md.path.split('/');
    segs.pop();
    const relDir = segs.join('/');
    const prefix = relDir ? `${relDir}/` : '';
    const pkgFiles = files.filter((f) => (relDir ? f.path === relDir || f.path.startsWith(prefix) : true));
    const parsed = parseSkillFile(md.contents, md.path, 'remote');
    const name = parsed?.manifest.name ?? fallbackSlug;
    const dirBase = relDir ? (relDir.split('/').pop() ?? fallbackSlug) : fallbackSlug;
    const slug = dirBase || fallbackSlug;
    out.push({
      slug,
      name,
      files: pkgFiles.map((f) => ({
        path: relDir ? f.path.slice(prefix.length) : f.path,
        contents: f.contents,
      })),
      skillMd: md.contents,
      relDir,
    });
  }
  return out;
}

function applyRootWhitelist(files: SnapshotFile[], isRepoRoot: boolean): SnapshotFile[] {
  if (!isRepoRoot) return files;
  return files.filter((f) => {
    const top = (f.path.split('/')[0] ?? '').toLowerCase();
    return ROOT_WHITELIST_TOP.has(top);
  });
}

function matchCandidate(cands: SkillCandidate[], slug: string | undefined): SkillCandidate {
  if (cands.length === 0) throw new SkillsHttpError(404, 'no_skills');
  if (!slug) {
    if (cands.length === 1) return cands[0]!;
    throw new SkillsHttpError(400, 'skill_ambiguous', {
      candidates: cands.map((c) => ({ slug: c.slug, name: c.name })),
    });
  }
  const want = slug.toLowerCase();
  const hit = cands.find(
    (c) => c.slug.toLowerCase() === want || c.name.toLowerCase() === want,
  );
  if (!hit) throw new SkillsHttpError(404, 'skill_not_in_source');
  return hit;
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

async function writeTree(tmp: string, files: SnapshotFile[], root: string): Promise<void> {
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
    await fsp.writeFile(dest, file.contents, 'utf8');
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

function selectFilesForPackage(cand: SkillCandidate): SnapshotFile[] {
  const isRepoRoot = cand.relDir === '' && cand.files.some((f) => f.path === 'SKILL.md');
  const filtered = applyRootWhitelist(cand.files, isRepoRoot);
  const hasSkill = filtered.some((f) => f.path === 'SKILL.md');
  return hasSkill ? filtered : cand.files;
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
  const cands = discoverSnapshotSkills(snap.files, src.slug ?? snap.slug);
  const cand = matchCandidate(cands, src.slug);
  const parsed = parseSkillFile(cand.skillMd, 'SKILL.md', 'remote');
  if (!parsed) throw new SkillsHttpError(404, 'no_skills');
  if (parsed.manifest.metadata?.internal === 'true' && !includeInternal) {
    throw new SkillsHttpError(404, 'no_skills');
  }

  const name = parsed.manifest.name;
  const remoteId = src.id ?? `${src.owner}/${src.repo}/${cand.slug}`;
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
    origin: 'skills.sh',
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
    `skills-install id=${remoteId} origin=skills.sh fetchPath=snapshot files=${files.length} ms=${ms}${shadowed ? ' shadowed=bundled' : ''}`,
  );

  const result: InstallRemoteResult = {
    id: row.id,
    name: row.name,
    source: 'remote',
    version: row.version,
    hash: snap.hash,
    scope,
    path: publicPathTail(finalSkillMd),
    fetchPath: 'snapshot',
  };
  if (shadowed) result.shadowed = shadowed;
  return result;
}

export async function installRemoteSkill(
  input: InstallRemoteInput,
  opts: { upsert: SkillUpsertFn },
): Promise<InstallRemoteResult> {
  if (input.confirm !== true) throw new SkillsHttpError(400, 'confirm_required');
  if (!isRemoteInstallEnabled()) throw new SkillsHttpError(403, 'install_disabled');

  const src = parseInstallSource(input);
  if (src.ref || src.kind !== 'github' || !src.slug) {
    throw new SkillsHttpError(422, 'install_source_unsupported');
  }

  const scope = resolveScope(input.scope);
  const snap = await fetchSkillSnapshot(src, { forInstall: true });
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
    throw new SkillsHttpError(422, 'install_source_unsupported');
  }
  if (src.ref || src.kind !== 'github' || !src.slug) {
    throw new SkillsHttpError(422, 'install_source_unsupported');
  }

  const snap = await fetchSkillSnapshot(src, { forInstall: true });
  if (sidecar.hash && snap.hash && sidecar.hash === snap.hash) {
    return {
      id: row.id,
      name: row.name,
      source: 'remote',
      version: null,
      hash: sidecar.hash,
      scope,
      path: publicPathTail(row.path),
      fetchPath: 'snapshot',
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

const CONTENT_BODY_MAX = 32 * 1024;

export async function readSkillContent(absPath: string): Promise<{ body: string; truncated: boolean } | null> {
  const safe = await assertReadableSkillFile(absPath);
  if (!safe) return null;
  const buf = await fsp.readFile(safe);
  const truncated = buf.byteLength > CONTENT_BODY_MAX;
  const slice = truncated ? buf.subarray(0, CONTENT_BODY_MAX) : buf;
  return { body: slice.toString('utf8'), truncated };
}
