import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import marketplace from './marketplace.js';
import * as settingsDb from '../db/settings.js';
import * as cat from '../lib/marketplace-catalog.js';

const app = new Hono();
app.route('/', marketplace);

describe('marketplace routes', () => {
  beforeEach(() => {
    vi.spyOn(settingsDb, 'getSetting').mockReturnValue(undefined);
    vi.spyOn(settingsDb, 'setSetting').mockImplementation(() => {});
    vi.spyOn(settingsDb, 'deleteSetting').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET catalog-url empty when unset', async () => {
    const res = await app.request('/catalog-url');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { url: string | null } };
    expect(body.ok).toBe(true);
    expect(body.data.url).toBeNull();
  });

  it('PUT catalog-url validates and stores', async () => {
    const bad = await app.request('/catalog-url', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://x' }),
    });
    expect(bad.status).toBe(400);

    const ok = await app.request('/catalog-url', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/catalog.json' }),
    });
    expect(ok.status).toBe(200);
    expect(settingsDb.setSetting).toHaveBeenCalledWith(
      'marketplace.catalogUrl',
      'https://example.com/catalog.json',
    );
  });

  it('GET catalog uses settings and returns entries', async () => {
    vi.spyOn(settingsDb, 'getSetting').mockReturnValue('https://example.com/catalog.json');
    vi.spyOn(cat, 'fetchRemoteCatalog').mockResolvedValue({
      schemaVersion: 'neos-marketplace/v1',
      name: 'T',
      entries: [
        {
          id: 'p1',
          name: 'P1',
          version: '1',
          trust: 'official',
          packageUrl: 'https://example.com/p1.json',
        },
      ],
    });
    const res = await app.request('/catalog');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { entries: Array<{ id: string }>; sourceUrl: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.entries[0]!.id).toBe('p1');
    expect(body.data.sourceUrl).toContain('example.com');
  });

  it('POST install by entry', async () => {
    vi.spyOn(cat, 'installCatalogEntry').mockResolvedValue({
      dir: '/tmp/x',
      id: 'p1',
      version: '1.0.0',
    });
    const res = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: {
          id: 'p1',
          name: 'P1',
          version: '1.0.0',
          trust: 'community',
          packageUrl: 'https://example.com/p1.json',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe('p1');
  });
});
