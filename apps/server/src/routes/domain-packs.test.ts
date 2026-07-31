import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOMAIN_PACK_MANIFEST_SCHEMA, unregisterPack } from '@neos-work/workflow-engine';
import domainPacks from './domain-packs.js';

const SAMPLE = {
  schema: DOMAIN_PACK_MANIFEST_SCHEMA,
  id: 'legal',
  name: 'Legal',
  description: 'Legal pack',
  workers: [
    {
      id: 'legal_reviewer',
      name: 'Reviewer',
      systemPrompt: 'You review contracts.',
    },
  ],
  blocks: [
    {
      id: 'legal_clause_check',
      name: 'Clause',
      implementationType: 'prompt',
      promptTemplate: 'Check {{input}}',
    },
  ],
};

let tmpRoot: string;
const prevData = process.env.NEOS_DATA_DIR;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-pack-route-'));
  process.env.NEOS_DATA_DIR = tmpRoot;
  unregisterPack('legal');
});

afterEach(async () => {
  unregisterPack('legal');
  if (prevData === undefined) delete process.env.NEOS_DATA_DIR;
  else process.env.NEOS_DATA_DIR = prevData;
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe('domain-packs routes', () => {
  it('lists four built-in packs with counts', async () => {
    const res = await domainPacks.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; workerCount: number; isBuiltIn: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.filter((p) => p.isBuiltIn).map((p) => p.id).sort()).toEqual(
      ['coding', 'finance', 'general', 'research'].sort(),
    );
    expect(body.data.filter((p) => p.isBuiltIn).every((p) => p.workerCount >= 2)).toBe(true);
  });

  it('returns pack detail with workers', async () => {
    const res = await domainPacks.request('/research');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { id: string; workers: Array<{ id: string }> };
    };
    expect(body.data.id).toBe('research');
    expect(body.data.workers.map((w) => w.id)).toEqual(
      expect.arrayContaining(['research_web', 'research_synthesizer']),
    );
  });

  it('404s unknown pack', async () => {
    const res = await domainPacks.request('/nope');
    expect(res.status).toBe(404);
  });

  it('404s blank and control-char pack ids', async () => {
    const blank = await domainPacks.request('/%20');
    expect(blank.status).toBe(404);
    const ctrl = await domainPacks.request(`/${encodeURIComponent('research\nid')}`);
    expect(ctrl.status).toBe(404);
  });

  it('returns coding pack with block ids', async () => {
    const res = await domainPacks.request('/coding');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; blockIds: string[]; workers: Array<{ id: string }> };
    };
    expect(body.data.id).toBe('coding');
    expect(body.data.blockIds.length).toBeGreaterThan(0);
    expect(body.data.workers.some((w) => w.id === 'coding_reviewer')).toBe(true);
  });

  it('validates manifest without install', async () => {
    const res = await domainPacks.request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string } };
    expect(body.data.id).toBe('legal');
  });

  it('rejects invalid manifest on validate', async () => {
    const res = await domainPacks.request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schema: 'nope', id: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('installs from path and lists custom pack', async () => {
    const src = path.join(tmpRoot, 'src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');

    const install = await domainPacks.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: src }),
    });
    expect(install.status).toBe(201);

    const list = await domainPacks.request('/');
    const body = (await list.json()) as {
      data: Array<{ id: string; isBuiltIn: boolean; enabled: boolean }>;
    };
    expect(body.data.some((p) => p.id === 'legal' && !p.isBuiltIn && p.enabled)).toBe(true);

    const detail = await domainPacks.request('/legal');
    expect(detail.status).toBe(200);

    const toggle = await domainPacks.request('/legal/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(200);

    const del = await domainPacks.request('/legal', { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('rejects install without path', async () => {
    const res = await domainPacks.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('domain-packs routes additional branches', () => {
  it('validate rejects empty body and accepts wrapped manifest', async () => {
    const empty = await domainPacks.request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });
    expect(empty.status).toBe(400);

    const wrapped = await domainPacks.request('/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: SAMPLE }),
    });
    expect(wrapped.status).toBe(200);
  });

  it('install fails for missing directory', async () => {
    const res = await domainPacks.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(tmpRoot, 'no-such-dir') }),
    });
    expect(res.status).toBe(400);
  });

  it('install-zip accepts raw zip body', async () => {
    const { ZipArchive } = await import('archiver');
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify(SAMPLE), { name: 'pack.json' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) {
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);

    const res = await domainPacks.request('/install-zip', {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'content-length': String(buf.length),
      },
      body: buf,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { id?: string } };
    expect(body.ok).toBe(true);
  });

  it('install-zip rejects empty body and oversized content-length', async () => {
    const empty = await domainPacks.request('/install-zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.alloc(0),
    });
    expect(empty.status).toBe(400);

    const tooBig = await domainPacks.request('/install-zip', {
      method: 'POST',
      headers: {
        'content-type': 'application/zip',
        'content-length': String(20 * 1024 * 1024),
      },
      body: Buffer.from('x'),
    });
    expect(tooBig.status).toBe(400);
  });

  it('toggle validates body and rejects built-in', async () => {
    const missing = await domainPacks.request('/research/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const builtin = await domainPacks.request('/research/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(builtin.status).toBe(400);

    const badId = await domainPacks.request('/%20/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(badId.status).toBe(404);
  });

  it('delete rejects built-in and bad id', async () => {
    const builtin = await domainPacks.request('/research', { method: 'DELETE' });
    expect(builtin.status).toBe(400);

    const badId = await domainPacks.request('/%20', { method: 'DELETE' });
    expect(badId.status).toBe(404);
  });
});

describe('domain-packs install-zip body read failure paths', () => {
  it('rejects invalid zip content with 400', async () => {
    const res = await domainPacks.request('/install-zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.from('not-zip-data'),
    });
    expect(res.status).toBe(400);
  });

  it('toggle 404 for missing installed pack', async () => {
    const res = await domainPacks.request('/not-installed-pack/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });
});
