import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipArchive } from 'archiver';
import {
  DOMAIN_PACK_MANIFEST_SCHEMA,
  resolveWorker,
  resolveBlock,
  resolvePack,
  unregisterPack,
  listPacks,
} from '@neos-work/workflow-engine';
import {
  installPackFromDir,
  installPackFromZipBuffer,
  loadInstalledDomainPacks,
  setInstalledPackEnabled,
  uninstallInstalledPack,
  resolveDomainPacksDir,
} from './domain-pack-store.js';

const SAMPLE = {
  schema: DOMAIN_PACK_MANIFEST_SCHEMA,
  id: 'legal',
  name: 'Legal',
  description: 'Legal pack',
  version: '1.0.0',
  workers: [
    {
      id: 'legal_reviewer',
      name: 'Reviewer',
      systemPrompt: 'You review contracts.',
      permissionProfile: 'read_only',
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-pack-'));
  process.env.NEOS_DATA_DIR = tmpRoot;
  unregisterPack('legal');
});

afterEach(async () => {
  unregisterPack('legal');
  if (prevData === undefined) delete process.env.NEOS_DATA_DIR;
  else process.env.NEOS_DATA_DIR = prevData;
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe('domain-pack-store', () => {
  it('installs from directory and registers workers/blocks', async () => {
    const src = path.join(tmpRoot, 'src-legal');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');

    const r = await installPackFromDir(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.packId).toBe('legal');
    expect(resolveWorker('legal_reviewer')?.domain).toBe('legal');
    expect(resolveBlock('legal_clause_check')?.implementationType).toBe('prompt');
    expect(resolvePack('legal')?.sourcePath).toContain('domain-packs');
    expect(listPacks().some((p) => p.id === 'legal' && p.isBuiltIn === false)).toBe(true);
  });

  it('rejects invalid pack from dir', async () => {
    const src = path.join(tmpRoot, 'bad');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(
      path.join(src, 'pack.json'),
      JSON.stringify({ schema: 'wrong', id: 'x' }),
      'utf8',
    );
    const r = await installPackFromDir(src);
    expect(r.ok).toBe(false);
  });

  it('rejects reserved built-in id', async () => {
    const src = path.join(tmpRoot, 'finance-steal');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(
      path.join(src, 'pack.json'),
      JSON.stringify({ ...SAMPLE, id: 'finance' }),
      'utf8',
    );
    const r = await installPackFromDir(src);
    expect(r.ok).toBe(false);
  });

  it('installs from zip buffer', async () => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify(SAMPLE), { name: 'pack.json' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) {
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    const r = await installPackFromZipBuffer(buf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveWorker('legal_reviewer')).toBeDefined();
  });

  it('toggle disable/enable and uninstall', async () => {
    const src = path.join(tmpRoot, 'src2');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    await installPackFromDir(src);

    const off = await setInstalledPackEnabled('legal', false);
    expect(off.ok).toBe(true);
    expect(resolveWorker('legal_reviewer')).toBeUndefined();

    const on = await setInstalledPackEnabled('legal', true);
    expect(on.ok).toBe(true);
    expect(resolveWorker('legal_reviewer')?.domain).toBe('legal');

    const del = await uninstallInstalledPack('legal');
    expect(del.ok).toBe(true);
    expect(resolvePack('legal')).toBeUndefined();
  });

  it('loadInstalledDomainPacks hydrates from disk', async () => {
    const packsDir = resolveDomainPacksDir();
    const dir = path.join(packsDir, 'legal');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ enabled: true }), 'utf8');

    unregisterPack('legal');
    const r = await loadInstalledDomainPacks();
    expect(r.loaded).toBeGreaterThanOrEqual(1);
    expect(resolveWorker('legal_reviewer')?.domain).toBe('legal');
  });
});
