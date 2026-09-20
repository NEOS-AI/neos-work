/** skills.sh search / preview / audit. Tests inject fetchImpl. */

import { createHash } from 'node:crypto';

import { parseSkillFile } from '@neos-work/core';
import { NEOS_VERSION } from '@neos-work/shared';

import { getSetting } from '../db/settings.js';
import { getDb } from '../db/schema.js';
import {
  classifyArchivePath,
  extractSkillZip,
  TEXT_FILE_MAX as ARCHIVE_TEXT_MAX,
  ZIPBALL_HTTP_MAX,
} from './skills-archive.js';
import { fetchPublicHttp, SsrfError } from './ssrf.js';
import {
  discoverSkillFolders,
  parseInstallSource,
  pickBySlug,
  pickSkillFolder,
  safeCatalogId,
  snapshotDownloadPath,
  SkillsHttpError,
  type InstallSource,
} from './skills-source.js';

export { SkillsHttpError, safeCatalogId } from './skills-source.js';

const CATALOG_ORIGIN = 'https://skills.sh';
const CATALOG_HOSTS = new Set(['skills.sh', 'www.skills.sh']);
const SEARCH_TTL_MS = 45_000;
const SEARCH_STALE_MS = 10 * 60_000;
const SEARCH_CACHE_MAX = 64;
const PREVIEW_TTL_MS = 5 * 60_000;
const PREVIEW_CACHE_MAX = 16;
const PREVIEW_CACHE_ENTRY_BYTES = 2 * 1024 * 1024;
const AUDIT_TTL_MS = 5 * 60_000;
const AUDIT_CACHE_MAX = 32;
const SEARCH_TIMEOUT_MS = 5_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const AUDIT_TIMEOUT_MS = 3_000;
const ZIPBALL_TIMEOUT_MS = 20_000;
const WELLKNOWN_TIMEOUT_MS = 5_000;
const DIRECT_TIMEOUT_MS = 5_000;
const SNAPSHOT_HTTP_MAX = 5 * 1024 * 1024;
const TEXT_FILE_MAX = ARCHIVE_TEXT_MAX;
const FILE_COUNT_MAX = 1_000;
const SKILL_MD_PREVIEW_MAX = 32_000;
const SEARCH_BUDGET_PER_MIN = 20;
const DOWNLOAD_BUDGET_PER_MIN = 10;
const AUDIT_BUDGET_PER_MIN = 10;
const ZIPBALL_BUDGET_PER_MIN = 6;
const WELLKNOWN_BUDGET_PER_MIN = 10;

const RAW_HOSTS = new Set(['raw.githubusercontent.com']);
const ZIPBALL_HOSTS = new Set(['codeload.github.com', 'github.com']);
const WK_SCHEMA_V020 = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const DIGEST_RE = /^sha256:([a-fA-F0-9]{64})$/;

export type FetchPath = 'snapshot' | 'zipball' | 'well-known' | 'direct';

const GITHUB_SOURCE_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/;
const WELLKNOWN_SOURCE_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

export type RemoteSkillHit = {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: 'github' | 'well-known' | 'unknown';
  installUrl: string | null;
  url: string;
  installed: boolean;
};

export type RemoteSkillAudit = {
  provider: string;
  slug: string;
  status: 'pass' | 'warn' | 'fail';
  summary?: string;
  riskLevel?: string;
  auditedAt?: string;
};

export type SnapshotFile = { path: string; contents: string | Buffer };

export type SkillSnapshot = {
  files: SnapshotFile[];
  hash: string | null;
  computedHash: string;
  id: string;
  slug: string;
  fetchPath: FetchPath;
};

export type CatalogSearchResult = {
  query: string;
  searchType: string;
  count: number;
  cached?: boolean;
  stale?: boolean;
  skills: RemoteSkillHit[];
};

export type CatalogPreviewResult = {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  hash: string | null;
  fileCount: number;
  files: Array<{ path: string; bytes: number }>;
  skillMd: string;
  truncated: boolean;
  trust: 'unverified';
  audits?: RemoteSkillAudit[];
  sourceUrl: string | null;
  skillsShUrl: string;
  fetchPath: FetchPath;
};

export type CatalogAuditResult = {
  audits: RemoteSkillAudit[];
  unavailable?: boolean;
};

type FetchImpl = typeof fetch;

let injectedFetch: FetchImpl | undefined;
let nowFn = (): number => Date.now();

export function setSkillsCatalogFetchImpl(impl?: FetchImpl): void {
  injectedFetch = impl;
}

export function getSkillsCatalogFetchImpl(): FetchImpl | undefined {
  return injectedFetch;
}

type CacheEntry<T> = { value: T; storedAt: number };

function createTtlCache<T>(max: number) {
  const map = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): CacheEntry<T> | undefined {
      return map.get(key);
    },
    set(key: string, value: T): void {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, storedAt: nowFn() });
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    age(ms: number): void {
      for (const entry of map.values()) entry.storedAt -= ms;
    },
    clear(): void {
      map.clear();
    },
  };
}

const searchCache = createTtlCache<CatalogSearchResult>(SEARCH_CACHE_MAX);
const previewCache = createTtlCache<CatalogPreviewResult>(PREVIEW_CACHE_MAX);
const auditCache = createTtlCache<CatalogAuditResult>(AUDIT_CACHE_MAX);
const searchInflight = new Map<string, Promise<CatalogSearchResult>>();

type BudgetBucket = { count: number; resetAt: number; inflight: number };

const budgets = new Map<string, BudgetBucket>();

function resetBudgets(): void {
  budgets.clear();
}

function consumeBudget(
  key: string,
  limit: number,
  inflightMax: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = nowFn();
  let bucket = budgets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000, inflight: 0 };
    budgets.set(key, bucket);
  }
  if (bucket.inflight >= inflightMax || bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  bucket.inflight += 1;
  return { ok: true };
}

function releaseBudget(key: string): void {
  const bucket = budgets.get(key);
  if (bucket && bucket.inflight > 0) bucket.inflight -= 1;
}

export function resetSkillsCatalogState(): void {
  injectedFetch = undefined;
  nowFn = () => Date.now();
  searchCache.clear();
  previewCache.clear();
  auditCache.clear();
  searchInflight.clear();
  resetBudgets();
}

/** Test helper: age search cache so entries become stale-but-usable. */
export function ageSkillsSearchCache(ms: number): void {
  searchCache.age(ms);
}

export function isRemoteCatalogEnabled(): boolean {
  const v = getSetting('skills.remoteCatalogEnabled');
  if (v === undefined) return true;
  return v.trim().toLowerCase() !== 'false';
}

export function isRemoteInstallEnabled(): boolean {
  const v = getSetting('skills.remoteInstallEnabled');
  if (v === undefined) return true;
  return v.trim().toLowerCase() !== 'false';
}

function resolveFetch(opts?: { fetchImpl?: FetchImpl }): FetchImpl | undefined {
  return opts?.fetchImpl ?? injectedFetch;
}

function catalogHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': `neos-work-skills/${NEOS_VERSION}`,
  };
}

function catalogHostOk(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  return CATALOG_HOSTS.has(h);
}

async function fetchCatalog(
  url: string,
  opts: { timeoutMs: number; fetchImpl?: FetchImpl },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const first = await fetchPublicHttp(url, {
      method: 'GET',
      headers: catalogHeaders(),
      signal: controller.signal,
      // Tests inject fetchImpl and must not touch live DNS.
      checkDns: !opts.fetchImpl,
      followOneRedirect: false,
      fetchImpl: opts.fetchImpl,
    });
    if (first.status < 300 || first.status >= 400) return first;
    const locRaw = first.headers?.get?.('location') ?? '';
    if (!locRaw || /[\0\r\n]/.test(locRaw)) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    let next: URL;
    try {
      next = new URL(locRaw, url);
    } catch {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (!catalogHostOk(next.hostname)) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    const second = await fetchPublicHttp(next.href, {
      method: 'GET',
      headers: catalogHeaders(),
      signal: controller.signal,
      checkDns: !opts.fetchImpl,
      followOneRedirect: false,
      fetchImpl: opts.fetchImpl,
    });
    if (second.status >= 300 && second.status < 400) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    return second;
  } catch (err) {
    if (err instanceof SkillsHttpError) throw err;
    if (err instanceof SsrfError) throw new SkillsHttpError(502, 'ssrf_blocked');
    if (isAbortError(err)) throw new SkillsHttpError(502, 'upstream_unavailable');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
    || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
  );
}

function retryAfterSec(res: Response, fallback = 60): number {
  const raw = res.headers?.get?.('retry-after') ?? '';
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(3_600, Math.floor(n)) || fallback;
  return fallback;
}

function mapAuthOrMissing(res: Response, json: unknown): never {
  const errField =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as { error?: unknown }).error
      : undefined;
  if (
    res.status === 401
    || res.status === 403
    || res.status === 404
    || errField === 'authentication_required'
    || errField === 'auth_required'
  ) {
    throw new SkillsHttpError(502, 'upstream_unavailable');
  }
  if (res.status === 429) {
    throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec(res) });
  }
  throw new SkillsHttpError(502, 'upstream_unavailable');
}

export function classifySourceType(source: string): 'github' | 'well-known' | 'unknown' {
  if (GITHUB_SOURCE_RE.test(source)) return 'github';
  if (WELLKNOWN_SOURCE_RE.test(source)) return 'well-known';
  return 'unknown';
}

function lastSegment(id: string): string {
  const parts = id.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? id;
}

function parseSearchHit(raw: unknown): Omit<RemoteSkillHit, 'installed'> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || /[\0\r\n]/.test(o.id) || !o.id.trim()) return null;
  if (typeof o.source !== 'string' || /[\0\r\n]/.test(o.source) || !o.source.trim()) return null;
  const id = o.id.trim().slice(0, 200);
  const source = o.source.trim().slice(0, 200);
  if (!id || !source) return null;
  let name = id;
  if (typeof o.name === 'string' && !/[\0\r\n]/.test(o.name) && o.name.trim()) {
    name = o.name.trim().slice(0, 200);
  }
  const slugRaw =
    typeof o.skillId === 'string' && !/[\0\r\n]/.test(o.skillId) && o.skillId.trim()
      ? o.skillId.trim()
      : lastSegment(id);
  const slug = slugRaw.slice(0, 100) || lastSegment(id);
  const installs = typeof o.installs === 'number' && Number.isFinite(o.installs) ? o.installs : 0;
  const sourceType = classifySourceType(source);
  const installUrl = sourceType === 'github' ? `https://github.com/${source}` : null;
  const url =
    sourceType === 'well-known'
      ? `https://skills.sh/site/${source}/${slug}`
      : `https://skills.sh/${id}`;
  return { id, slug, name, source, installs, sourceType, installUrl, url };
}

function readManifestProvenance(manifestJson: string | null): { id?: string } | null {
  if (!manifestJson) return null;
  try {
    const m = JSON.parse(manifestJson) as { provenance?: { id?: unknown } };
    if (!m || typeof m !== 'object' || !m.provenance || typeof m.provenance !== 'object') return null;
    const id = typeof m.provenance.id === 'string' ? m.provenance.id : undefined;
    return { id };
  } catch {
    return null;
  }
}

function markInstalled(hits: Array<Omit<RemoteSkillHit, 'installed'>>): RemoteSkillHit[] {
  type Row = { name: string; manifest_json: string | null };
  let rows: Row[] = [];
  try {
    rows = getDb()
      .prepare('SELECT name, manifest_json FROM skill')
      .all() as Row[];
  } catch {
    rows = [];
  }
  return hits.map((hit) => {
    let installed = false;
    for (const row of rows) {
      const prov = readManifestProvenance(row.manifest_json);
      if (prov && typeof prov.id === 'string' && prov.id === hit.id) {
        installed = true;
        break;
      }
      if (!prov && row.name.toLowerCase() === hit.slug.toLowerCase()) {
        installed = true;
        break;
      }
    }
    return { ...hit, installed };
  });
}

function validateSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n\x00-\x1f]/.test(raw)) {
    throw new SkillsHttpError(400, 'query_too_short');
  }
  const q = raw.trim();
  if (q.length < 2 || q.length > 200) throw new SkillsHttpError(400, 'query_too_short');
  return q;
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 20;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function parseOwner(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) {
    throw new SkillsHttpError(400, 'invalid_id');
  }
  const owner = raw.trim().toLowerCase();
  if (!owner) return undefined;
  if (!OWNER_RE.test(owner)) throw new SkillsHttpError(400, 'invalid_id');
  return owner;
}

export async function searchSkillCatalog(
  input: { q: unknown; limit?: unknown; owner?: unknown },
  opts?: { fetchImpl?: FetchImpl },
): Promise<CatalogSearchResult> {
  if (!isRemoteCatalogEnabled()) throw new SkillsHttpError(403, 'catalog_disabled');
  const q = validateSearchQuery(input.q);
  const limit = parseLimit(input.limit);
  const owner = parseOwner(input.owner);
  const cacheKey = `${q}\t${limit}\t${owner ?? ''}`;
  const cached = searchCache.get(cacheKey);
  const now = nowFn();
  if (cached && now - cached.storedAt <= SEARCH_TTL_MS) {
    return { ...cached.value, cached: true, skills: markInstalled(cached.value.skills) };
  }

  const inflight = searchInflight.get(cacheKey);
  if (inflight) return inflight;

  const pending = (async () => {
    const budget = consumeBudget('search', SEARCH_BUDGET_PER_MIN, 1);
    if (!budget.ok) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: budget.retryAfterSec });
    }
    const started = nowFn();
    try {
      const url = new URL(`${CATALOG_ORIGIN}/api/search`);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(limit));
      if (owner) url.searchParams.set('owner', owner);
      let res: Response;
      try {
        res = await fetchCatalog(url.href, {
          timeoutMs: SEARCH_TIMEOUT_MS,
          fetchImpl: resolveFetch(opts),
        });
      } catch (err) {
        if (err instanceof SkillsHttpError && err.code === 'upstream_unavailable' && cached
          && now - cached.storedAt <= SEARCH_STALE_MS) {
          return { ...cached.value, cached: true, stale: true, skills: markInstalled(cached.value.skills) };
        }
        throw err;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      let json: unknown;
      try {
        json = JSON.parse(buf.toString('utf8'));
      } catch {
        if (cached && now - cached.storedAt <= SEARCH_STALE_MS) {
          return { ...cached.value, cached: true, stale: true, skills: markInstalled(cached.value.skills) };
        }
        throw new SkillsHttpError(502, 'invalid_upstream');
      }

      if (res.status === 429) {
        throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec(res) });
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        mapAuthOrMissing(res, json);
      }
      if (res.status !== 200) {
        if (cached && now - cached.storedAt <= SEARCH_STALE_MS) {
          return { ...cached.value, cached: true, stale: true, skills: markInstalled(cached.value.skills) };
        }
        if (res.status >= 500) throw new SkillsHttpError(502, 'upstream_unavailable');
        mapAuthOrMissing(res, json);
      }

      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new SkillsHttpError(502, 'invalid_upstream');
      }
      const body = json as Record<string, unknown>;
      if (body.error === 'authentication_required' || body.error === 'auth_required') {
        throw new SkillsHttpError(502, 'upstream_unavailable');
      }
      if (!Array.isArray(body.skills)) {
        if (cached && now - cached.storedAt <= SEARCH_STALE_MS) {
          return { ...cached.value, cached: true, stale: true, skills: markInstalled(cached.value.skills) };
        }
        throw new SkillsHttpError(502, 'invalid_upstream');
      }

      const hits: Array<Omit<RemoteSkillHit, 'installed'>> = [];
      for (const item of body.skills) {
        const hit = parseSearchHit(item);
        if (hit) hits.push(hit);
      }
      const searchType =
        typeof body.searchType === 'string' && !/[\0\r\n]/.test(body.searchType)
          ? body.searchType.trim().slice(0, 40) || 'fuzzy'
          : 'fuzzy';
      const result: CatalogSearchResult = {
        query: typeof body.query === 'string' && !/[\0\r\n]/.test(body.query) ? body.query : q,
        searchType,
        count: hits.length,
        skills: markInstalled(hits),
      };
      searchCache.set(cacheKey, { ...result, skills: hits as RemoteSkillHit[] });
      const ms = nowFn() - started;
      console.log(`skills-catalog search q_len=${q.length} count=${result.count} ms=${ms} cached=false`);
      return result;
    } finally {
      releaseBudget('search');
    }
  })();

  searchInflight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    searchInflight.delete(cacheKey);
  }
}

/** Exact local-lock.ts loop: sort relativePath, update path then content, no NUL. */
export function computeSkillFolderHash(
  files: Array<{ relativePath: string; content: string | Buffer }>,
): string {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash('sha256');
  for (const file of sorted) {
    hash.update(file.relativePath.replace(/\\/g, '/'));
    hash.update(typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content);
  }
  return hash.digest('hex');
}

function parseSnapshotBody(json: unknown): { files: SnapshotFile[]; hash: string | null } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new SkillsHttpError(502, 'invalid_upstream');
  }
  const o = json as Record<string, unknown>;
  if (o.error === 'not_found') {
    throw new SkillsHttpError(502, 'upstream_unavailable');
  }
  if (!Array.isArray(o.files) || o.files.length === 0) {
    throw new SkillsHttpError(502, 'invalid_upstream');
  }
  const files: SnapshotFile[] = [];
  for (const item of o.files.slice(0, FILE_COUNT_MAX)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    const f = item as { path?: unknown; contents?: unknown };
    if (typeof f.path !== 'string' || typeof f.contents !== 'string') {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    const verdict = classifyArchivePath(f.path);
    if (verdict === 'reject') throw new SkillsHttpError(502, 'invalid_upstream');
    if (verdict === 'skip') continue;
    if (Buffer.byteLength(f.contents, 'utf8') > TEXT_FILE_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    files.push({ path: f.path.replace(/\\/g, '/').replace(/^\.\//, ''), contents: f.contents });
  }
  if (files.length === 0) throw new SkillsHttpError(502, 'invalid_upstream');
  let hash: string | null = null;
  if (typeof o.hash === 'string' && /^[a-fA-F0-9]{64}$/.test(o.hash.trim())) {
    hash = o.hash.trim().toLowerCase();
  }
  return { files, hash };
}

function snapshotFromFiles(
  src: InstallSource,
  files: SnapshotFile[],
  hash: string | null,
  fetchPath: FetchPath,
  idFallback: string,
): SkillSnapshot {
  const computedHash = computeSkillFolderHash(
    files.map((f) => ({ relativePath: f.path, content: f.contents })),
  );
  return {
    files,
    hash,
    computedHash,
    id: src.id ?? idFallback,
    slug: src.slug ?? lastSegment(idFallback),
    fetchPath,
  };
}

export async function fetchSkillSnapshot(
  src: InstallSource,
  opts?: { fetchImpl?: FetchImpl },
): Promise<SkillSnapshot> {
  const rel = snapshotDownloadPath(src);
  if (!rel) throw new SkillsHttpError(502, 'upstream_unavailable');
  const budget = consumeBudget('download', DOWNLOAD_BUDGET_PER_MIN, 2);
  if (!budget.ok) {
    throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: budget.retryAfterSec });
  }
  try {
    const url = `${CATALOG_ORIGIN}/api/download/${rel.split('/').map(encodeURIComponent).join('/')}`;
    let res: Response;
    try {
      res = await fetchCatalog(url, {
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
        fetchImpl: resolveFetch(opts),
      });
    } catch (err) {
      if (err instanceof SkillsHttpError && err.code === 'rate_limited') throw err;
      if (err instanceof SkillsHttpError && err.code === 'ssrf_blocked') throw err;
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (res.status === 429) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec(res) });
    }
    if (res.status === 404 || res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (res.status !== 200) throw new SkillsHttpError(502, 'upstream_unavailable');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > SNAPSHOT_HTTP_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (json && typeof json === 'object' && !Array.isArray(json)
      && (json as { error?: unknown }).error === 'not_found') {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    const parsed = parseSnapshotBody(json);
    return snapshotFromFiles(src, parsed.files, parsed.hash, 'snapshot', rel);
  } finally {
    releaseBudget('download');
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.trim().toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function hostOk(url: string, allow: Set<string>): boolean {
  const h = hostOf(url);
  return !!h && allow.has(h);
}

async function fetchPublicBytes(
  url: string,
  opts: {
    timeoutMs: number;
    maxBytes: number;
    hosts?: Set<string>;
    fetchImpl?: FetchImpl;
    accept?: string;
  },
): Promise<{ status: number; buf: Buffer; headers: Headers }> {
  if (opts.hosts && !hostOk(url, opts.hosts)) {
    throw new SkillsHttpError(502, 'ssrf_blocked');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetchPublicHttp(url, {
      method: 'GET',
      headers: {
        Accept: opts.accept ?? '*/*',
        'User-Agent': `neos-work-skills/${NEOS_VERSION}`,
      },
      signal: controller.signal,
      checkDns: !opts.fetchImpl,
      followOneRedirect: true,
      fetchImpl: opts.fetchImpl,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (opts.hosts && !hostOk(res.url || url, opts.hosts) && res.status === 200) {
      throw new SkillsHttpError(502, 'ssrf_blocked');
    }
    const clRaw = res.headers?.get?.('content-length') ?? '';
    const cl = Number(clRaw);
    if (Number.isFinite(cl) && cl > opts.maxBytes) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > opts.maxBytes) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    return { status: res.status, buf, headers: res.headers };
  } catch (err) {
    if (err instanceof SkillsHttpError) throw err;
    if (err instanceof SsrfError) throw new SkillsHttpError(502, 'ssrf_blocked');
    if (isAbortError(err)) throw new SkillsHttpError(502, 'upstream_unavailable');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function wrapSkillMd(text: string): SnapshotFile[] {
  if (Buffer.byteLength(text, 'utf8') > TEXT_FILE_MAX) {
    throw new SkillsHttpError(502, 'upstream_too_large');
  }
  return [{ path: 'SKILL.md', contents: text }];
}

function githubRawUrls(src: InstallSource): string[] {
  const owner = src.owner ?? '';
  const repo = src.repo ?? '';
  const refs = src.ref ? [src.ref] : ['main', 'master'];
  const rels = src.slug ? [`skills/${src.slug}`, ''] : [''];
  const urls: string[] = [];
  for (const rel of rels) {
    for (const ref of refs) {
      const segs = [owner, repo, ref, ...(rel ? rel.split('/') : []), 'SKILL.md'];
      urls.push(`https://raw.githubusercontent.com/${segs.map(encodeURIComponent).join('/')}`);
    }
  }
  return urls;
}

async function fetchGithubRawPreview(
  src: InstallSource,
  fetchImpl?: FetchImpl,
): Promise<SkillSnapshot> {
  if (!src.owner || !src.repo) throw new SkillsHttpError(502, 'upstream_unavailable');
  let lastStatus = 0;
  for (const url of githubRawUrls(src)) {
    const got = await fetchPublicBytes(url, {
      timeoutMs: DIRECT_TIMEOUT_MS,
      maxBytes: TEXT_FILE_MAX,
      hosts: RAW_HOSTS,
      fetchImpl,
      accept: 'text/plain, text/markdown, */*',
    });
    lastStatus = got.status;
    if (got.status === 404) continue;
    if (got.status === 429) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec({
        headers: got.headers,
      } as Response) });
    }
    if (got.status !== 200) continue;
    const text = got.buf.toString('utf8');
    if (!text.trim()) continue;
    return snapshotFromFiles(
      src,
      wrapSkillMd(text),
      null,
      'direct',
      src.id ?? `${src.owner}/${src.repo}`,
    );
  }
  if (lastStatus >= 500) throw new SkillsHttpError(502, 'upstream_unavailable');
  throw new SkillsHttpError(502, 'upstream_unavailable');
}

function zipballUrl(owner: string, repo: string, ref: string): string {
  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodeURIComponent(ref)}`;
}

async function fetchGithubZipball(
  src: InstallSource,
  fetchImpl?: FetchImpl,
): Promise<SkillSnapshot> {
  if (!src.owner || !src.repo) {
    throw new SkillsHttpError(502, 'upstream_unavailable', {
      message: 'Could not fetch repository archive',
    });
  }
  const refs = src.ref ? [src.ref] : ['main', 'master'];
  let lastMiss = false;
  for (const ref of refs) {
    const budget = consumeBudget('zipball', ZIPBALL_BUDGET_PER_MIN, 1);
    if (!budget.ok) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: budget.retryAfterSec });
    }
    try {
      const got = await fetchPublicBytes(zipballUrl(src.owner, src.repo, ref), {
        timeoutMs: ZIPBALL_TIMEOUT_MS,
        maxBytes: ZIPBALL_HTTP_MAX,
        hosts: ZIPBALL_HOSTS,
        fetchImpl,
        accept: 'application/zip, application/octet-stream, */*',
      });
      if (got.status === 404) {
        lastMiss = true;
        continue;
      }
      if (got.status === 429) {
        throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec({
          headers: got.headers,
        } as Response) });
      }
      if (got.status !== 200) {
        lastMiss = true;
        continue;
      }
      return snapshotFromFiles(
        src,
        await extractSkillZip(got.buf),
        null,
        'zipball',
        src.id ?? `${src.owner}/${src.repo}`,
      );
    } finally {
      releaseBudget('zipball');
    }
  }
  if (lastMiss) {
    throw new SkillsHttpError(502, 'upstream_unavailable', {
      message: 'Could not fetch repository archive',
    });
  }
  throw new SkillsHttpError(502, 'upstream_unavailable', {
    message: 'Could not fetch repository archive',
  });
}

function isScopedWellKnownUrl(u: URL): boolean {
  const path = u.pathname || '/';
  return path !== '/';
}

function wellKnownProbeUrls(rawUrl: string): string[] {
  const u = new URL(rawUrl);
  if (/\/\.well-known\/(agent-skills|skills)\/index\.json$/i.test(u.pathname)) {
    return [u.href];
  }
  const scoped = isScopedWellKnownUrl(u);
  const pathBase = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  const urls: string[] = [
    `${pathBase}/.well-known/agent-skills/index.json`,
  ];
  if (!scoped) urls.push(`${u.origin}/.well-known/agent-skills/index.json`);
  urls.push(`${pathBase}/.well-known/skills/index.json`);
  if (!scoped) urls.push(`${u.origin}/.well-known/skills/index.json`);
  return [...new Set(urls)];
}

type WkIndexEntry = {
  name: string;
  type?: 'skill-md' | 'archive';
  description?: string;
  url?: string;
  digest?: string;
  files?: string[];
};

type WkIndex = { kind: 'v020' | 'legacy'; entries: WkIndexEntry[]; indexUrl: string };

function parseDigest(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = DIGEST_RE.exec(raw.trim());
  return m ? `sha256:${m[1]!.toLowerCase()}` : null;
}

function sha256Digest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readWkEntries(raw: unknown): WkIndexEntry[] | null {
  if (Array.isArray(raw)) return raw as WkIndexEntry[];
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.skills)) return o.skills as WkIndexEntry[];
  if (Array.isArray(o.entries)) return o.entries as WkIndexEntry[];
  if (typeof o.name === 'string') return [o as WkIndexEntry];
  return null;
}

function parseWellKnownIndex(json: unknown, indexUrl: string): WkIndex | 'ignore' | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.$schema === 'string' && o.$schema !== WK_SCHEMA_V020) return 'ignore';
  const rawEntries = readWkEntries(json);
  if (!rawEntries) return null;
  if (o.$schema === WK_SCHEMA_V020) {
    const entries: WkIndexEntry[] = [];
    for (const item of rawEntries) {
      if (!item || typeof item !== 'object') continue;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name || /[\0\r\n]/.test(name)) continue;
      const digest = parseDigest(item.digest);
      if (!digest) continue;
      const url = typeof item.url === 'string' && !/[\0\r\n]/.test(item.url) ? item.url.trim() : '';
      if (!url) continue;
      const type = item.type === 'archive' ? 'archive' : 'skill-md';
      const description =
        typeof item.description === 'string' && !/[\0\r\n]/.test(item.description)
          ? item.description.trim()
          : undefined;
      entries.push({ name, type, url, digest, description });
    }
    return { kind: 'v020', entries, indexUrl };
  }
  const entries: WkIndexEntry[] = [];
  for (const item of rawEntries) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || /[\0\r\n]/.test(name)) continue;
    const files = Array.isArray(item.files)
      ? item.files.filter((f): f is string => typeof f === 'string' && !!f.trim() && !/[\0\r\n]/.test(f))
      : [];
    if (!files.some((f) => f.split('/').pop()?.toLowerCase() === 'skill.md')) continue;
    const description =
      typeof item.description === 'string' && !/[\0\r\n]/.test(item.description)
        ? item.description.trim()
        : undefined;
    entries.push({ name, files, description });
  }
  return { kind: 'legacy', entries, indexUrl };
}

async function probeWellKnownIndex(
  src: InstallSource,
  fetchImpl?: FetchImpl,
): Promise<WkIndex> {
  if (!src.url) throw new SkillsHttpError(400, 'invalid_source');
  let base: URL;
  try {
    base = new URL(src.url);
  } catch {
    throw new SkillsHttpError(400, 'invalid_source');
  }
  const scoped = isScopedWellKnownUrl(base);
  const probes = wellKnownProbeUrls(src.url);
  let sawServerError = false;
  for (const url of probes) {
    const budget = consumeBudget('well-known', WELLKNOWN_BUDGET_PER_MIN, 2);
    if (!budget.ok) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: budget.retryAfterSec });
    }
    try {
      const got = await fetchPublicBytes(url, {
        timeoutMs: WELLKNOWN_TIMEOUT_MS,
        maxBytes: TEXT_FILE_MAX,
        fetchImpl,
        accept: 'application/json, */*',
      });
      if (got.status === 404) continue;
      if (got.status === 429) {
        throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec({
          headers: got.headers,
        } as Response) });
      }
      if (got.status !== 200) {
        if (got.status >= 500) sawServerError = true;
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(got.buf.toString('utf8'));
      } catch {
        continue;
      }
      const parsed = parseWellKnownIndex(json, url);
      if (parsed === 'ignore' || !parsed) continue;
      if (parsed.entries.length === 0) continue;
      return parsed;
    } catch (err) {
      if (err instanceof SkillsHttpError && err.code === 'rate_limited') throw err;
      if (err instanceof SkillsHttpError && err.code === 'ssrf_blocked') throw err;
      if (err instanceof SkillsHttpError && err.code === 'upstream_too_large') throw err;
      sawServerError = true;
    } finally {
      releaseBudget('well-known');
    }
  }
  if (scoped) throw new SkillsHttpError(404, 'no_skills');
  if (sawServerError) throw new SkillsHttpError(502, 'upstream_unavailable');
  throw new SkillsHttpError(404, 'no_skills');
}

function resolveAgainst(indexUrl: string, rel: string): string {
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = new URL(indexUrl);
  const dir = base.pathname.replace(/\/index\.json$/i, '/');
  return new URL(rel.replace(/^\/+/, ''), `${base.origin}${dir}`).href;
}

async function fetchDirectSkillMd(
  url: string,
  fetchImpl?: FetchImpl,
): Promise<string> {
  const got = await fetchPublicBytes(url, {
    timeoutMs: DIRECT_TIMEOUT_MS,
    maxBytes: TEXT_FILE_MAX,
    fetchImpl,
    accept: 'text/plain, text/markdown, */*',
  });
  if (got.status === 404) throw new SkillsHttpError(404, 'no_skills');
  if (got.status === 429) {
    throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec({
      headers: got.headers,
    } as Response) });
  }
  if (got.status !== 200) throw new SkillsHttpError(502, 'upstream_unavailable');
  return got.buf.toString('utf8');
}

async function fetchWellKnownEntry(
  src: InstallSource,
  index: WkIndex,
  fetchImpl?: FetchImpl,
): Promise<SkillSnapshot> {
  const picked = pickBySlug(
    index.entries.map((e) => ({ slug: e.name, name: e.name, entry: e })),
    src.slug,
  );
  const entry = picked.entry;

  if (index.kind === 'v020') {
    if (!entry.url) throw new SkillsHttpError(404, 'no_skills');
    const got = await fetchPublicBytes(entry.url, {
      timeoutMs: entry.type === 'archive' ? ZIPBALL_TIMEOUT_MS : WELLKNOWN_TIMEOUT_MS,
      maxBytes: entry.type === 'archive' ? ZIPBALL_HTTP_MAX : TEXT_FILE_MAX,
      fetchImpl,
    });
    if (got.status !== 200) throw new SkillsHttpError(502, 'upstream_unavailable');
    if (entry.digest && sha256Digest(got.buf) !== entry.digest) {
      throw new SkillsHttpError(502, 'hash_mismatch');
    }
    const hashHex = entry.digest?.slice('sha256:'.length) ?? null;
    if (entry.type === 'archive') {
      return snapshotFromFiles(
        src,
        await extractSkillZip(got.buf),
        hashHex,
        'well-known',
        src.id ?? src.url ?? entry.name,
      );
    }
    return snapshotFromFiles(
      src,
      wrapSkillMd(got.buf.toString('utf8')),
      hashHex,
      'well-known',
      src.id ?? src.url ?? entry.name,
    );
  }

  const files = entry.files ?? [];
  const out: SnapshotFile[] = [];
  for (const rel of files) {
    const fileUrl = /^https?:\/\//i.test(rel)
      ? rel
      : resolveAgainst(index.indexUrl, `${entry.name}/${rel}`);
    const text = await fetchDirectSkillMd(fileUrl, fetchImpl);
    const path = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    const verdict = classifyArchivePath(path);
    if (verdict === 'reject') throw new SkillsHttpError(502, 'invalid_upstream');
    if (verdict === 'skip') continue;
    out.push({ path, contents: text });
  }
  if (!out.some((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'))) {
    throw new SkillsHttpError(404, 'no_skills');
  }
  return snapshotFromFiles(src, out, null, 'well-known', src.id ?? src.url ?? entry.name);
}

async function fetchDirectSource(
  src: InstallSource,
  fetchImpl?: FetchImpl,
): Promise<SkillSnapshot> {
  if (!src.url) throw new SkillsHttpError(400, 'invalid_source');
  const text = await fetchDirectSkillMd(src.url, fetchImpl);
  return snapshotFromFiles(src, wrapSkillMd(text), null, 'direct', src.id ?? src.url);
}

/** Unified file resolve for preview + install. Preview never downloads a GitHub zip. */
export async function resolveSkillFiles(
  src: InstallSource,
  opts?: { fetchImpl?: FetchImpl; preview?: boolean },
): Promise<SkillSnapshot> {
  const fetchImpl = resolveFetch(opts);
  if (src.kind === 'direct') {
    return fetchDirectSource(src, fetchImpl);
  }
  if (src.kind === 'well-known') {
    const index = await probeWellKnownIndex(src, fetchImpl);
    return fetchWellKnownEntry(src, index, fetchImpl);
  }

  if (!src.ref) {
    try {
      return await fetchSkillSnapshot(src, { fetchImpl });
    } catch (err) {
      if (err instanceof SkillsHttpError && err.code === 'rate_limited') throw err;
      if (err instanceof SkillsHttpError && err.code === 'upstream_too_large') throw err;
      if (err instanceof SkillsHttpError && err.code === 'ssrf_blocked') throw err;
      // not_found / 401 / 5xx / non-JSON / invalid snapshot → zip or raw
    }
  }

  if (opts?.preview) {
    return fetchGithubRawPreview(src, fetchImpl);
  }
  return fetchGithubZipball(src, fetchImpl);
}

export async function previewRemoteSkill(
  input: { id?: unknown; url?: unknown },
  opts?: { fetchImpl?: FetchImpl },
): Promise<CatalogPreviewResult> {
  if (!isRemoteCatalogEnabled()) throw new SkillsHttpError(403, 'catalog_disabled');

  const id = typeof input.id === 'string' ? safeCatalogId(input.id) : '';
  const url = typeof input.url === 'string' && !/[\0\r\n]/.test(input.url) ? input.url.trim() : '';
  if (input.id !== undefined && input.id !== '' && !id && !url) {
    throw new SkillsHttpError(400, 'invalid_id');
  }
  if (!id && !url) throw new SkillsHttpError(400, 'invalid_id');

  const cacheKey = id ? `id:${id}` : `url:${url}`;
  const cached = previewCache.get(cacheKey);
  if (cached && nowFn() - cached.storedAt <= PREVIEW_TTL_MS) {
    return cached.value;
  }

  const src = parseInstallSource(id ? { id } : { url });
  const snap = await resolveSkillFiles(src, { fetchImpl: resolveFetch(opts), preview: true });
  const picked = pickSkillFolder(discoverSkillFolders(snap.files, src.slug ?? snap.slug), src.slug);
  const rawMd = picked.skillMd;
  const truncated = rawMd.length > SKILL_MD_PREVIEW_MAX;
  const skillMd = truncated ? rawMd.slice(0, SKILL_MD_PREVIEW_MAX) : rawMd;

  const parsed = parseSkillFile(rawMd || '---\nname: unknown\n---\n', 'SKILL.md', 'remote');
  const name = parsed?.manifest.name || src.slug || snap.slug;
  const description = parsed?.manifest.description ?? '';
  const license = parsed?.manifest.license;

  const result: CatalogPreviewResult = {
    id: src.id ?? id,
    slug: src.slug ?? picked.slug ?? snap.slug,
    name,
    description,
    hash: snap.hash,
    fileCount: picked.files.length || snap.files.length,
    files: (picked.files.length ? picked.files : snap.files).map((f) => ({
      path: f.path,
      bytes: typeof f.contents === 'string'
        ? Buffer.byteLength(f.contents, 'utf8')
        : f.contents.byteLength,
    })),
    skillMd,
    truncated,
    trust: 'unverified',
    sourceUrl:
      src.kind === 'github' && src.owner && src.repo
        ? `https://github.com/${src.owner}/${src.repo}`
        : src.url ?? null,
    skillsShUrl: `https://skills.sh/${src.id ?? id}`,
    fetchPath: snap.fetchPath,
  };
  if (license) result.license = license;

  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes <= PREVIEW_CACHE_ENTRY_BYTES) previewCache.set(cacheKey, result);
  return result;
}

function stripSitePrefix(id: string): string {
  return id.startsWith('site/') ? id.slice('site/'.length) : id;
}

function parseAudits(raw: unknown): RemoteSkillAudit[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { audits?: unknown }).audits)
      ? (raw as { audits: unknown[] }).audits
      : [];
  const out: RemoteSkillAudit[] = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const provider = typeof o.provider === 'string' && !/[\0\r\n]/.test(o.provider) ? o.provider.trim() : '';
    const slug = typeof o.slug === 'string' && !/[\0\r\n]/.test(o.slug) ? o.slug.trim() : provider;
    const status = o.status === 'pass' || o.status === 'warn' || o.status === 'fail' ? o.status : null;
    if (!provider || !status) continue;
    const row: RemoteSkillAudit = { provider: provider.slice(0, 80), slug: (slug || provider).slice(0, 80), status };
    if (typeof o.summary === 'string' && !/[\0\r\n]/.test(o.summary)) {
      row.summary = o.summary.trim().slice(0, 500);
    }
    if (typeof o.riskLevel === 'string' && !/[\0\r\n]/.test(o.riskLevel)) {
      row.riskLevel = o.riskLevel.trim().slice(0, 40);
    }
    if (typeof o.auditedAt === 'string' && !/[\0\r\n]/.test(o.auditedAt)) {
      row.auditedAt = o.auditedAt.trim().slice(0, 64);
    }
    out.push(row);
  }
  return out;
}

export async function auditRemoteSkill(
  input: { id?: unknown },
  opts?: { fetchImpl?: FetchImpl },
): Promise<CatalogAuditResult> {
  if (!isRemoteCatalogEnabled()) throw new SkillsHttpError(403, 'catalog_disabled');
  const id = typeof input.id === 'string' ? safeCatalogId(stripSitePrefix(input.id)) : '';
  if (!id) return { audits: [], unavailable: true };

  const cached = auditCache.get(id);
  if (cached && nowFn() - cached.storedAt <= AUDIT_TTL_MS) return cached.value;

  const budget = consumeBudget('audit', AUDIT_BUDGET_PER_MIN, 2);
  if (!budget.ok) return { audits: [], unavailable: true };

  const unavailable: CatalogAuditResult = { audits: [], unavailable: true };
  try {
    const url = `${CATALOG_ORIGIN}/api/v1/skills/audit/${id.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetchCatalog(url, {
      timeoutMs: AUDIT_TIMEOUT_MS,
      fetchImpl: resolveFetch(opts),
    });
    if (res.status !== 200) {
      auditCache.set(id, unavailable);
      return unavailable;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      auditCache.set(id, unavailable);
      return unavailable;
    }
    const result: CatalogAuditResult = { audits: parseAudits(json) };
    auditCache.set(id, result);
    return result;
  } catch {
    auditCache.set(id, unavailable);
    return unavailable;
  } finally {
    releaseBudget('audit');
  }
}
