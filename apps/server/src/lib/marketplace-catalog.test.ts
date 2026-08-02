import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  installCatalogEntry,
  parseRemoteCatalog,
  trustRank,
  type CatalogEntry,
} from './marketplace-catalog.js';

describe('marketplace-catalog', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it('parseRemoteCatalog validates schema and entries', () => {
    const cat = parseRemoteCatalog({
      schemaVersion: 'neos-marketplace/v1',
      name: 'Demo',
      entries: [
        {
          id: 'hello-plugin',
          name: 'Hello',
          version: '1.0.0',
          trust: 'community',
          packageUrl: 'https://example.com/hello.json',
        },
        { id: '../evil', packageUrl: 'https://example.com/x' }, // dropped
        { id: 'no-url', name: 'X' }, // dropped
      ],
    });
    expect(cat.entries).toHaveLength(1);
    expect(cat.entries[0]!.id).toBe('hello-plugin');
    expect(cat.entries[0]!.trust).toBe('community');
  });

  it('parseRemoteCatalog rejects bad schema', () => {
    expect(() => parseRemoteCatalog({ schemaVersion: 'v0', entries: [] })).toThrow(/schemaVersion/);
  });

  it('trustRank orders official first', () => {
    expect(trustRank('official')).toBeLessThan(trustRank('community'));
    expect(trustRank('community')).toBeLessThan(trustRank('unverified'));
  });

  it('installCatalogEntry writes open-design.json with integrity check', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-mkt-'));
    const body = JSON.stringify({
      schemaVersion: 'od-plugin/v1',
      id: 'remote-hello',
      name: 'Remote Hello',
      version: '2.0.0',
      pipeline: [{ id: 'p', name: 'P', kind: 'plan', prompt: 'hi' }],
    });
    const sha = createHash('sha256').update(body).digest('hex');
    const fetchImpl = vi.fn(async () => {
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    // fetchPublicHttp uses real DNS for example.com — use mock that bypasses via fetchImpl only
    // Our install uses fetchPublicHttp which still SSRF-checks host. example.com is public OK.
    const entry: CatalogEntry = {
      id: 'remote-hello',
      name: 'Remote Hello',
      version: '2.0.0',
      trust: 'community',
      packageUrl: 'https://example.com/remote-hello.json',
      sha256: sha,
    };
    const result = await installCatalogEntry(entry, { fetchImpl, skillsDir: tmp });
    expect(result.id).toBe('remote-hello');
    const written = await fs.readFile(path.join(tmp, 'remote-hello', 'open-design.json'), 'utf8');
    const m = JSON.parse(written) as { id: string; version: string };
    expect(m.id).toBe('remote-hello');
    expect(m.version).toBe('2.0.0');
    const prov = await fs.readFile(path.join(tmp, 'remote-hello', 'neos-remote.json'), 'utf8');
    expect(prov).toMatch(/remote-catalog/);
  });

  it('installCatalogEntry rejects sha256 mismatch', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-mkt-'));
    const body = JSON.stringify({
      schemaVersion: 'od-plugin/v1',
      id: 'x',
      name: 'X',
      version: '1',
    });
    const fetchImpl = vi.fn(
      async () => new Response(body, { status: 200 }),
    );
    await expect(
      installCatalogEntry(
        {
          id: 'x',
          name: 'X',
          version: '1',
          trust: 'unverified',
          packageUrl: 'https://example.com/x.json',
          sha256: '0'.repeat(64),
        },
        { fetchImpl, skillsDir: tmp },
      ),
    ).rejects.toThrow(/sha256/);
  });
});
