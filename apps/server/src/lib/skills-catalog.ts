/**
 * skills.sh search / preview / audit (PR 2a snapshot-only).
 * Network is injected via fetchImpl — no catalogBaseUrl, no HTML scrape.
 */

import { createHash } from 'node:crypto';

import { NEOS_VERSION } from '@neos-work/shared';

import { getSetting } from '../db/settings.js';
import { getDb } from '../db/schema.js';
import { fetchPublicHttp, SsrfError } from './ssrf.js';
import {
  parseInstallSource,
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
const SNAPSHOT_HTTP_MAX = 5 * 1024 * 1024;
const TEXT_FILE_MAX = 1 * 1024 * 1024;
const FILE_COUNT_MAX = 1_000;
const SKILL_MD_PREVIEW_MAX = 32_000;
const SEARCH_BUDGET_PER_MIN = 20;
const DOWNLOAD_BUDGET_PER_MIN = 10;
const AUDIT_BUDGET_PER_MIN = 10;

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

export type SnapshotFile = { path: string; contents: string };

export type SkillSnapshot = {
  files: SnapshotFile[];
  hash: string | null;
  computedHash: string;
  id: string;
  slug: string;
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
  fetchPath: 'snapshot';
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

export function setSkillsCatalogNow(fn?: () => number): void {
  nowFn = fn ?? (() => Date.now());
}

type CacheEntry<T> = { value: T; storedAt: number; bytes: number };

function createTtlCache<T>(max: number) {
  const map = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): CacheEntry<T> | undefined {
      return map.get(key);
    },
    set(key: string, value: T, bytes: number): void {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, storedAt: nowFn(), bytes });
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
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const owner = raw.trim().toLowerCase();
  return OWNER_RE.test(owner) ? owner : undefined;
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
      searchCache.set(cacheKey, { ...result, skills: hits as RemoteSkillHit[] }, buf.byteLength);
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

export function isSafeSnapshotRelPath(raw: unknown): 'ok' | 'skip' | 'reject' {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'reject';
  const n = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.length > 500) return 'reject';
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return 'reject';
  const segs = n.split('/');
  if (segs.some((s) => s === '..' || s === '')) return 'reject';
  if (/[\x00-\x1f]/.test(n)) return 'reject';
  const lowerSegs = segs.map((s) => s.toLowerCase());
  if (lowerSegs[0] === '__macosx' || lowerSegs.includes('.git') || lowerSegs.includes('node_modules')) {
    return 'skip';
  }
  return 'ok';
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
    const verdict = isSafeSnapshotRelPath(f.path);
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

export async function fetchSkillSnapshot(
  src: InstallSource,
  opts?: { fetchImpl?: FetchImpl; forInstall?: boolean },
): Promise<SkillSnapshot> {
  const rel = snapshotDownloadPath(src);
  if (!rel) {
    if (opts?.forInstall) throw new SkillsHttpError(422, 'install_source_unsupported');
    throw new SkillsHttpError(502, 'upstream_unavailable');
  }
  const budget = consumeBudget('download', DOWNLOAD_BUDGET_PER_MIN, 2);
  if (!budget.ok) {
    throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: budget.retryAfterSec });
  }
  try {
    const url = `${CATALOG_ORIGIN}/api/download/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetchCatalog(url, {
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
      fetchImpl: resolveFetch(opts),
    });
    if (res.status === 404) {
      throw new SkillsHttpError(
        opts?.forInstall ? 422 : 502,
        opts?.forInstall ? 'install_source_unsupported' : 'upstream_unavailable',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    if (res.status === 429) {
      throw new SkillsHttpError(429, 'rate_limited', { retryAfterSec: retryAfterSec(res) });
    }
    if (res.status !== 200) {
      throw new SkillsHttpError(502, 'upstream_unavailable');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > SNAPSHOT_HTTP_MAX) {
      throw new SkillsHttpError(502, 'upstream_too_large');
    }
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new SkillsHttpError(502, 'invalid_upstream');
    }
    if (json && typeof json === 'object' && !Array.isArray(json)
      && (json as { error?: unknown }).error === 'not_found') {
      throw new SkillsHttpError(opts?.forInstall ? 422 : 502, opts?.forInstall ? 'install_source_unsupported' : 'upstream_unavailable');
    }
    const parsed = parseSnapshotBody(json);
    const computedHash = computeSkillFolderHash(
      parsed.files.map((f) => ({ relativePath: f.path, content: f.contents })),
    );
    return {
      files: parsed.files,
      hash: parsed.hash,
      computedHash,
      id: src.id ?? rel,
      slug: src.slug ?? lastSegment(rel),
    };
  } finally {
    releaseBudget('download');
  }
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

  let src: InstallSource;
  try {
    src = parseInstallSource(id ? { id } : { url });
  } catch (err) {
    if (err instanceof SkillsHttpError) throw new SkillsHttpError(502, 'upstream_unavailable');
    throw err;
  }

  const snap = await fetchSkillSnapshot(src, { fetchImpl: resolveFetch(opts), forInstall: false });
  const skillFile = snap.files.find((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
  const rawMd = skillFile?.contents ?? '';
  const truncated = rawMd.length > SKILL_MD_PREVIEW_MAX;
  const skillMd = truncated ? rawMd.slice(0, SKILL_MD_PREVIEW_MAX) : rawMd;

  const { parseSkillFile } = await import('@neos-work/core');
  const parsed = parseSkillFile(rawMd || '---\nname: unknown\n---\n', 'SKILL.md', 'remote');
  const name = parsed?.manifest.name || src.slug || snap.slug;
  const description = parsed?.manifest.description ?? '';
  const license = parsed?.manifest.license;

  const result: CatalogPreviewResult = {
    id: src.id ?? id,
    slug: src.slug ?? snap.slug,
    name,
    description,
    hash: snap.hash,
    fileCount: snap.files.length,
    files: snap.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.contents, 'utf8') })),
    skillMd,
    truncated,
    trust: 'unverified',
    sourceUrl:
      src.kind === 'github' && src.owner && src.repo
        ? `https://github.com/${src.owner}/${src.repo}`
        : src.url ?? null,
    skillsShUrl: `https://skills.sh/${src.id ?? id}`,
    fetchPath: 'snapshot',
  };
  if (license) result.license = license;

  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes <= PREVIEW_CACHE_ENTRY_BYTES) previewCache.set(cacheKey, result, bytes);
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
      auditCache.set(id, unavailable, 32);
      return unavailable;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      auditCache.set(id, unavailable, 32);
      return unavailable;
    }
    const result: CatalogAuditResult = { audits: parseAudits(json) };
    auditCache.set(id, result, buf.byteLength);
    return result;
  } catch {
    auditCache.set(id, unavailable, 32);
    return unavailable;
  } finally {
    releaseBudget('audit');
  }
}
