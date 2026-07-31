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

describe('domain-pack-store additional branches', () => {
  it('readPackManifestFromDir rejects invalid paths and files', async () => {
    const { readPackManifestFromDir } = await import('./domain-pack-store.js');
    expect((await readPackManifestFromDir('')).ok).toBe(false);
    expect((await readPackManifestFromDir(path.join(tmpRoot, 'missing'))).ok).toBe(false);
    const file = path.join(tmpRoot, 'not-dir.txt');
    await fs.writeFile(file, 'x');
    expect((await readPackManifestFromDir(file)).ok).toBe(false);
    const emptyDir = path.join(tmpRoot, 'empty-pack');
    await fs.mkdir(emptyDir);
    expect((await readPackManifestFromDir(emptyDir)).ok).toBe(false);
  });

  it('rejects empty and invalid zip buffers', async () => {
    expect((await installPackFromZipBuffer(Buffer.alloc(0))).ok).toBe(false);
    expect((await installPackFromZipBuffer(Buffer.from('not-a-zip'))).ok).toBe(false);
  });

  it('zip without pack.json fails', async () => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append('hello', { name: 'readme.md' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    const r = await installPackFromZipBuffer(Buffer.concat(chunks));
    expect(r.ok).toBe(false);
  });

  it('zip with reserved id fails', async () => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify({ ...SAMPLE, id: 'finance' }), { name: 'pack.json' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    const r = await installPackFromZipBuffer(Buffer.concat(chunks));
    expect(r.ok).toBe(false);
  });

  it('setInstalledPackEnabled rejects built-in and missing', async () => {
    expect((await setInstalledPackEnabled('research', false)).ok).toBe(false);
    expect((await setInstalledPackEnabled('nope-pack', true)).ok).toBe(false);
    expect((await setInstalledPackEnabled('bad\nid', true)).ok).toBe(false);
  });

  it('uninstall rejects built-in and control id', async () => {
    expect((await uninstallInstalledPack('coding')).ok).toBe(false);
    expect((await uninstallInstalledPack('x\ny')).ok).toBe(false);
  });

  it('rejects path-traversal pack ids (no rm outside domain-packs)', async () => {
    const root = resolveDomainPacksDir();
    const parent = path.dirname(root);
    const marker = path.join(parent, `_pack_traversal_${process.pid}.marker`);
    await fs.writeFile(marker, 'keep', 'utf8');
    try {
      for (const bad of ['..', '../', '../../tmp', 'a/b', '../db', '.'] as const) {
        const off = await setInstalledPackEnabled(bad, false);
        expect(off.ok).toBe(false);
        if (!off.ok) expect(off.error).toMatch(/invalid/i);
        const del = await uninstallInstalledPack(bad);
        expect(del.ok).toBe(false);
        if (!del.ok) expect(del.error).toMatch(/invalid/i);
      }
      // Parent marker must survive (would be deleted if `..` resolved + rm)
      await expect(fs.readFile(marker, 'utf8')).resolves.toBe('keep');
    } finally {
      await fs.rm(marker, { force: true }).catch(() => undefined);
    }
  });

  it('resolveDomainPacksDir uses NEOS_DATA_DIR', () => {
    expect(resolveDomainPacksDir()).toContain(tmpRoot);
    expect(resolveDomainPacksDir()).toMatch(/domain-packs$/);
  });

  it('loadInstalledDomainPacks handles missing root and id mismatch', async () => {
    const empty = await loadInstalledDomainPacks();
    // may be 0 if nothing installed
    expect(empty.loaded).toBeGreaterThanOrEqual(0);

    const packsDir = resolveDomainPacksDir();
    const dir = path.join(packsDir, 'wrong-name');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    const r = await loadInstalledDomainPacks();
    expect(r.errors.some((e) => /does not match directory/i.test(e))).toBe(true);
  });

  it('loadInstalledDomainPacks skips non-slug directory names', async () => {
    const packsDir = resolveDomainPacksDir();
    const bad = path.join(packsDir, 'Bad Name');
    await fs.mkdir(bad, { recursive: true });
    await fs.writeFile(path.join(bad, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    const r = await loadInstalledDomainPacks();
    expect(r.errors.some((e) => /invalid pack directory name/i.test(e))).toBe(true);
    // Must not register under traversal-like names either
    expect(listPacks().some((p) => p.id === 'Bad Name')).toBe(false);
  });
});

describe('domain-pack-store install variants', () => {
  it('accepts neos-pack.json and overwrites existing install', async () => {
    const src = path.join(tmpRoot, 'neos-named');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'neos-pack.json'), JSON.stringify(SAMPLE), 'utf8');
    const first = await installPackFromDir(src);
    expect(first.ok).toBe(true);

    // overwrite with updated name
    await fs.writeFile(
      path.join(src, 'neos-pack.json'),
      JSON.stringify({ ...SAMPLE, name: 'Legal v2' }),
      'utf8',
    );
    const second = await installPackFromDir(src);
    expect(second.ok).toBe(true);
    expect(resolvePack('legal')?.name).toBe('Legal v2');
  });

  it('rejects oversized zip buffer', async () => {
    const { DOMAIN_PACK_ZIP_MAX_BYTES } = await import('./domain-pack-store.js');
    const huge = Buffer.alloc(DOMAIN_PACK_ZIP_MAX_BYTES + 1);
    const r = await installPackFromZipBuffer(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exceeds max/i);
  });

  it('zip with nested folder prefix still installs', async () => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify(SAMPLE), { name: 'legal/pack.json' });
    archive.append('# Legal', { name: 'legal/README.md' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    unregisterPack('legal');
    const r = await installPackFromZipBuffer(Buffer.concat(chunks));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.packId).toBe('legal');
  });

  it('rejects invalid manifest json content that is too large', async () => {
    const { readPackManifestFromDir, DOMAIN_PACK_MANIFEST_MAX_CHARS } = await import(
      './domain-pack-store.js'
    );
    const dir = path.join(tmpRoot, 'huge-manifest');
    await fs.mkdir(dir, { recursive: true });
    const huge = JSON.stringify({
      ...SAMPLE,
      description: 'x'.repeat(DOMAIN_PACK_MANIFEST_MAX_CHARS),
    });
    await fs.writeFile(path.join(dir, 'pack.json'), huge, 'utf8');
    const r = await readPackManifestFromDir(dir);
    expect(r.ok).toBe(false);
  });
});

describe('domain-pack-store resolve without NEOS_DATA_DIR', () => {
  it('falls back when NEOS_DATA_DIR unset', () => {
    const prev = process.env.NEOS_DATA_DIR;
    delete process.env.NEOS_DATA_DIR;
    try {
      const dir = resolveDomainPacksDir();
      expect(dir).toMatch(/domain-packs$/);
    } finally {
      if (prev === undefined) delete process.env.NEOS_DATA_DIR;
      else process.env.NEOS_DATA_DIR = prev;
    }
  });

  it('video-like: zip with invalid nested traversal entries is skipped safely', async () => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify(SAMPLE), { name: 'pack.json' });
    archive.append('x', { name: '../evil.txt' });
    archive.append('y', { name: 'nested/deep.md' });
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    unregisterPack('legal');
    const r = await installPackFromZipBuffer(Buffer.concat(chunks));
    expect(r.ok).toBe(true);
  });

  it('setInstalledPackEnabled reloads from disk when not in registry', async () => {
    const packsDir = resolveDomainPacksDir();
    const dir = path.join(packsDir, 'legal');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ enabled: true }), 'utf8');
    unregisterPack('legal');
    const r = await setInstalledPackEnabled('legal', false);
    expect(r.ok).toBe(true);
    // cleanup
    await uninstallInstalledPack('legal');
  });
});

describe('domain-pack-store zip safety', () => {
  it('rejects zip exceeding max file count', async () => {
    const { DOMAIN_PACK_ZIP_MAX_FILES } = await import('./domain-pack-store.js');
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append(JSON.stringify(SAMPLE), { name: 'pack.json' });
    for (let i = 0; i < DOMAIN_PACK_ZIP_MAX_FILES + 2; i++) {
      archive.append(`f${i}`, { name: `extra-${i}.txt` });
    }
    archive.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    const r = await installPackFromZipBuffer(Buffer.concat(chunks));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/max/i);
  });

  it('rejects zip entries whose names contain colon (ADS/scheme)', async () => {
    // Craft raw local-file headers so unzipper sees colon names (archiver normalizes paths)
    const { deflateSync } = await import('node:zlib');
    function zipOne(name: string, content: string): Buffer {
      const nameBuf = Buffer.from(name, 'utf8');
      const data = Buffer.from(content, 'utf8');
      const compressed = deflateSync(data);
      const local = Buffer.alloc(30 + nameBuf.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version
      local.writeUInt16LE(0, 6); // flags
      local.writeUInt16LE(8, 8); // deflate
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(0, 14); // crc skip
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      nameBuf.copy(local, 30);
      const central = Buffer.alloc(46 + nameBuf.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(0, 16);
      central.writeUInt32LE(compressed.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(0, 42); // offset
      nameBuf.copy(central, 46);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(0, 4);
      end.writeUInt16LE(0, 6);
      end.writeUInt16LE(1, 8);
      end.writeUInt16LE(1, 10);
      end.writeUInt32LE(central.length, 12);
      end.writeUInt32LE(local.length + compressed.length, 16);
      end.writeUInt16LE(0, 20);
      return Buffer.concat([local, compressed, central, end]);
    }
    // Single-entry zip with colon is enough to hit unsafe-path reject
    const buf = zipOne('evil:ads.txt', 'x');
    const r = await installPackFromZipBuffer(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsafe|manifest|invalid/i);
  });
});

describe('domain-pack-store load/state edges', () => {
  it('treats state.json with null bytes as enabled=true', async () => {
    const packsDir = resolveDomainPacksDir();
    const dir = path.join(packsDir, 'legal');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pack.json'), JSON.stringify(SAMPLE), 'utf8');
    await fs.writeFile(path.join(dir, 'state.json'), '{"enabled":false}\0', 'utf8');
    unregisterPack('legal');
    const r = await loadInstalledDomainPacks();
    expect(r.loaded).toBeGreaterThanOrEqual(1);
    // null-byte state falls back to enabled
    expect(resolvePack('legal')?.enabled).not.toBe(false);
  });

  it('skips non-directories and records invalid manifests on load', async () => {
    const packsDir = resolveDomainPacksDir();
    await fs.mkdir(packsDir, { recursive: true });
    await fs.writeFile(path.join(packsDir, 'not-a-dir.txt'), 'x', 'utf8');
    const badDir = path.join(packsDir, 'broken-pack');
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, 'pack.json'), '{not-json', 'utf8');
    const r = await loadInstalledDomainPacks();
    expect(r.errors.some((e) => /broken-pack/i.test(e))).toBe(true);
  });

  it('installPackFromDir rejects control-char source path', async () => {
    const r = await installPackFromDir(`bad${'\n'}path`);
    expect(r.ok).toBe(false);
  });
});
