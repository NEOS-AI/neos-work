/**
 * Remote marketplace catalog (v0.6 M4).
 * Opt-in URL → fetch JSON catalog (SSRF-safe) → install open-design.json into user skills.
 * Local bundled plugins remain primary; remote never replaces them unless same id is installed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fetchPublicHttp, SsrfError } from './ssrf.js';

export const MARKETPLACE_SCHEMA = 'neos-marketplace/v1' as const;
export type TrustTier = 'official' | 'community' | 'unverified';

export type CatalogEntry = {
  id: string;
  name: string;
  description?: string;
  version: string;
  trust: TrustTier;
  /** HTTPS URL to open-design.json body (or package that is pure JSON). */
  packageUrl: string;
  /** Optional hex sha256 of package body. */
  sha256?: string;
};

export type RemoteCatalog = {
  schemaVersion: typeof MARKETPLACE_SCHEMA;
  name?: string;
  updatedAt?: string;
  entries: CatalogEntry[];
};

const CATALOG_MAX_BYTES = 512_000;
const PACKAGE_MAX_BYTES = 256_000;
const ENTRY_MAX = 200;

function userSkillsDir(): string {
  if (process.env.NEOS_DATA_DIR && !/[\0\r\n]/.test(process.env.NEOS_DATA_DIR)) {
    const root = path.resolve(process.env.NEOS_DATA_DIR.trim());
    return path.join(root, 'skills');
  }
  return path.join(os.homedir(), '.config', 'neos-work', 'skills');
}

export function normalizeCatalogUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const t = raw.trim();
  if (!t || t.length > 2_048) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function sanitizeId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > 100) return '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) return '';
  return id;
}

function parseTrust(raw: unknown): TrustTier {
  if (raw === 'official' || raw === 'community' || raw === 'unverified') return raw;
  return 'unverified';
}

/** Parse and validate catalog JSON (no network). */
export function parseRemoteCatalog(raw: unknown): RemoteCatalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Catalog must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== MARKETPLACE_SCHEMA) {
    throw new Error(`Unsupported schemaVersion (want ${MARKETPLACE_SCHEMA})`);
  }
  if (!Array.isArray(o.entries)) {
    throw new Error('entries must be an array');
  }
  const entries: CatalogEntry[] = [];
  for (const item of o.entries.slice(0, ENTRY_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const id = sanitizeId(e.id);
    if (!id) continue;
    let name = id;
    if (typeof e.name === 'string' && !/[\0\r\n]/.test(e.name)) {
      name = e.name.trim().slice(0, 200) || id;
    }
    let description: string | undefined;
    if (typeof e.description === 'string' && !/\0/.test(e.description)) {
      description = e.description.replace(/[\r\n]+/g, ' ').trim().slice(0, 2_000) || undefined;
    }
    let version = '0.0.0';
    if (typeof e.version === 'string' && !/[\0\r\n]/.test(e.version)) {
      version = e.version.trim().slice(0, 64) || '0.0.0';
    }
    const packageUrl = normalizeCatalogUrl(e.packageUrl);
    if (!packageUrl) continue;
    let sha256: string | undefined;
    if (typeof e.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(e.sha256.trim())) {
      sha256 = e.sha256.trim().toLowerCase();
    }
    entries.push({
      id,
      name,
      description,
      version,
      trust: parseTrust(e.trust),
      packageUrl,
      sha256,
    });
  }
  let catalogName: string | undefined;
  if (typeof o.name === 'string' && !/[\0\r\n]/.test(o.name)) {
    catalogName = o.name.trim().slice(0, 200) || undefined;
  }
  let updatedAt: string | undefined;
  if (typeof o.updatedAt === 'string' && !/[\0\r\n]/.test(o.updatedAt)) {
    updatedAt = o.updatedAt.trim().slice(0, 64) || undefined;
  }
  return {
    schemaVersion: MARKETPLACE_SCHEMA,
    name: catalogName,
    updatedAt,
    entries,
  };
}

export async function fetchRemoteCatalog(
  catalogUrl: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<RemoteCatalog> {
  const url = normalizeCatalogUrl(catalogUrl);
  if (!url) throw new Error('Invalid catalog URL');
  let res: Response;
  try {
    res = await fetchPublicHttp(url, {
      method: 'GET',
      checkDns: true,
      fetchImpl: opts?.fetchImpl,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'neos-work-marketplace/0.6.4',
      },
    });
  } catch (err) {
    if (err instanceof SsrfError) throw new Error(`Catalog URL blocked: ${err.message}`);
    throw err;
  }
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > CATALOG_MAX_BYTES) throw new Error('Catalog too large');
  let json: unknown;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Catalog is not valid JSON');
  }
  return parseRemoteCatalog(json);
}

export async function installCatalogEntry(
  entry: CatalogEntry,
  opts?: { fetchImpl?: typeof fetch; skillsDir?: string },
): Promise<{ dir: string; id: string; version: string }> {
  const id = sanitizeId(entry.id);
  if (!id) throw new Error('Invalid entry id');
  const packageUrl = normalizeCatalogUrl(entry.packageUrl);
  if (!packageUrl) throw new Error('Invalid packageUrl');

  let res: Response;
  try {
    res = await fetchPublicHttp(packageUrl, {
      method: 'GET',
      checkDns: true,
      fetchImpl: opts?.fetchImpl,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'neos-work-marketplace/0.6.4',
      },
    });
  } catch (err) {
    if (err instanceof SsrfError) throw new Error(`Package URL blocked: ${err.message}`);
    throw err;
  }
  if (!res.ok) throw new Error(`Package HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('Empty package');
  if (buf.byteLength > PACKAGE_MAX_BYTES) throw new Error('Package too large');

  if (entry.sha256) {
    const dig = createHash('sha256').update(buf).digest('hex');
    if (dig !== entry.sha256.toLowerCase()) {
      throw new Error('Package sha256 mismatch');
    }
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Package is not open-design.json JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid plugin manifest');
  }
  const m = manifest as Record<string, unknown>;
  if (m.schemaVersion !== 'od-plugin/v1') {
    throw new Error('schemaVersion must be od-plugin/v1');
  }
  // Force id from catalog entry for path safety
  m.id = id;
  if (typeof m.name !== 'string' || !m.name.trim()) m.name = entry.name || id;
  if (typeof m.version !== 'string' || !m.version.trim()) m.version = entry.version || '0.0.0';

  const skillsRoot = opts?.skillsDir ?? userSkillsDir();
  const dir = path.join(skillsRoot, id);
  // Refuse if path would escape (id is sanitized)
  if (!dir.startsWith(skillsRoot)) throw new Error('Install path rejected');

  await fs.mkdir(skillsRoot, { recursive: true });
  // Refuse planting over symlink
  try {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink()) throw new Error('Install target is a symlink');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'open-design.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  // Optional provenance sidecar (not a secret)
  await fs.writeFile(
    path.join(dir, 'neos-remote.json'),
    `${JSON.stringify(
      {
        source: 'remote-catalog',
        trust: entry.trust,
        packageUrl,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    dir,
    id,
    version: typeof m.version === 'string' ? m.version : entry.version,
  };
}

/** Trust rank for sorting UI (official first). */
export function trustRank(t: TrustTier): number {
  if (t === 'official') return 0;
  if (t === 'community') return 1;
  return 2;
}

export function marketplaceInstallRootExists(): boolean {
  return existsSync(userSkillsDir());
}
