/**
 * Remote marketplace routes (v0.6 M4).
 *
 * GET  /api/marketplace/catalog?url=…  — fetch/parse catalog (url optional; uses settings)
 * PUT  /api/marketplace/catalog-url    — persist marketplace.catalogUrl setting
 * GET  /api/marketplace/catalog-url    — read configured URL (not secret)
 * POST /api/marketplace/install        — install entry by id from catalog
 */

import { Hono } from 'hono';
import * as settingsDb from '../db/settings.js';
import {
  fetchRemoteCatalog,
  installCatalogEntry,
  normalizeCatalogUrl,
  trustRank,
  type CatalogEntry,
} from '../lib/marketplace-catalog.js';
import { publicErrorMessage } from '../lib/errors.js';

const marketplace = new Hono();

const SETTING_KEY = 'marketplace.catalogUrl';

function readConfiguredUrl(): string | null {
  const v = settingsDb.getSetting(SETTING_KEY);
  return normalizeCatalogUrl(v ?? '');
}

marketplace.get('/catalog-url', (c) => {
  return c.json({ ok: true, data: { url: readConfiguredUrl() } });
});

marketplace.put('/catalog-url', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (!body || typeof body.url !== 'string') {
    return c.json({ ok: false, error: 'url string required' }, 400);
  }
  const trimmed = body.url.trim();
  if (!trimmed) {
    settingsDb.deleteSetting(SETTING_KEY);
    return c.json({ ok: true, data: { url: null } });
  }
  const url = normalizeCatalogUrl(trimmed);
  if (!url) return c.json({ ok: false, error: 'Invalid catalog URL (http/https only)' }, 400);
  settingsDb.setSetting(SETTING_KEY, url);
  return c.json({ ok: true, data: { url } });
});

marketplace.get('/catalog', async (c) => {
  const q = c.req.query('url');
  const url =
    (typeof q === 'string' && !/[\0\r\n]/.test(q) ? normalizeCatalogUrl(q) : null)
    ?? readConfiguredUrl();
  if (!url) {
    return c.json(
      {
        ok: false,
        error: 'No catalog URL configured. Set marketplace.catalogUrl or pass ?url=',
      },
      400,
    );
  }
  try {
    const catalog = await fetchRemoteCatalog(url);
    const entries = [...catalog.entries].sort(
      (a, b) => trustRank(a.trust) - trustRank(b.trust) || a.name.localeCompare(b.name),
    );
    return c.json({
      ok: true,
      data: {
        ...catalog,
        entries,
        sourceUrl: url,
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: publicErrorMessage(err, 'Failed to fetch catalog') },
      502,
    );
  }
});

marketplace.post('/install', async (c) => {
  const body = await c.req
    .json<{ id?: string; url?: string; entry?: CatalogEntry }>()
    .catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  let entry: CatalogEntry | null = null;

  if (body.entry && typeof body.entry === 'object') {
    // Direct entry install (still SSRF-checked on packageUrl)
    const e = body.entry;
    entry = {
      id: typeof e.id === 'string' ? e.id : '',
      name: typeof e.name === 'string' ? e.name : '',
      version: typeof e.version === 'string' ? e.version : '0.0.0',
      trust:
        e.trust === 'official' || e.trust === 'community' || e.trust === 'unverified'
          ? e.trust
          : 'unverified',
      packageUrl: typeof e.packageUrl === 'string' ? e.packageUrl : '',
      sha256: typeof e.sha256 === 'string' ? e.sha256 : undefined,
      description: typeof e.description === 'string' ? e.description : undefined,
    };
  } else if (typeof body.id === 'string' && body.id.trim()) {
    const catalogUrl =
      (typeof body.url === 'string' ? normalizeCatalogUrl(body.url) : null) ?? readConfiguredUrl();
    if (!catalogUrl) {
      return c.json({ ok: false, error: 'Catalog URL required' }, 400);
    }
    try {
      const catalog = await fetchRemoteCatalog(catalogUrl);
      const id = body.id.trim();
      entry = catalog.entries.find((e) => e.id === id) ?? null;
      if (!entry) return c.json({ ok: false, error: 'Entry not found in catalog' }, 404);
    } catch (err) {
      return c.json(
        { ok: false, error: publicErrorMessage(err, 'Failed to fetch catalog') },
        502,
      );
    }
  } else {
    return c.json({ ok: false, error: 'id or entry required' }, 400);
  }

  if (!entry || !entry.id || !entry.packageUrl) {
    return c.json({ ok: false, error: 'Invalid entry' }, 400);
  }

  try {
    const result = await installCatalogEntry(entry);
    return c.json({
      ok: true,
      data: {
        id: result.id,
        version: result.version,
        trust: entry.trust,
        message: `Installed ${result.id}@${result.version} (trust: ${entry.trust})`,
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: publicErrorMessage(err, 'Install failed') },
      400,
    );
  }
});

export default marketplace;
