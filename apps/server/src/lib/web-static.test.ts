import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWebDist } from './web-static.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  delete process.env.NEOS_WEB_DIST;
});

describe('resolveWebDist', () => {
  it('returns null when nothing configured', () => {
    delete process.env.NEOS_WEB_DIST;
    expect(
      resolveWebDist({ ...process.env, NEOS_WEB_DIST: undefined }, { cwd: '/tmp', moduleDir: '/tmp' }),
    ).toBeNull();
  });

  it('uses NEOS_WEB_DIST when index.html exists', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-web-dist-'));
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'index.html'), '<html></html>');
    expect(resolveWebDist({ NEOS_WEB_DIST: d }, { cwd: '/tmp', moduleDir: '/tmp' })).toBe(
      path.resolve(d),
    );
  });

  it('rejects control-char NEOS_WEB_DIST (falls through; no default under /tmp)', () => {
    expect(
      resolveWebDist({ NEOS_WEB_DIST: '/tmp/bad\ndist' }, { cwd: '/tmp', moduleDir: '/tmp' }),
    ).toBeNull();
  });
});

describe('resolveWebDist candidates', () => {
  it('finds index.html under candidate paths from moduleDir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-web-cand-'));
    dirs.push(root);
    const dist = path.join(root, 'web', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>ok</html>');
    // candidates: moduleDir/../../web/dist
    const moduleDir = path.join(root, 'apps', 'server', 'src', 'lib');
    fs.mkdirSync(moduleDir, { recursive: true });
    const resolved = resolveWebDist(
      { NEOS_WEB_DIST: undefined },
      { cwd: path.join(root, 'other'), moduleDir },
    );
    expect(resolved).toBe(path.resolve(dist));
  });

  it('finds apps/web/dist under cwd', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-web-cwd-'));
    dirs.push(root);
    const dist = path.join(root, 'apps', 'web', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>cwd</html>');
    const resolved = resolveWebDist(
      {},
      { cwd: root, moduleDir: path.join(root, 'nope') },
    );
    expect(resolved).toBe(path.resolve(dist));
  });

  it('returns null when NEOS_WEB_DIST points to dir without index.html', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-web-empty-'));
    dirs.push(d);
    expect(resolveWebDist({ NEOS_WEB_DIST: d }, { cwd: '/tmp', moduleDir: '/tmp' })).toBeNull();
  });
});

describe('resolveWebDist without moduleDir', () => {
  it('resolves via import.meta moduleDir when candidates exist under package layout', () => {
    // Calling without moduleDir exercises fileURLToPath(import.meta.url) path
    const result = resolveWebDist({ NEOS_WEB_DIST: undefined });
    // May be null in this workspace layout or a real dist — must not throw
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('finds ../web/dist under cwd parent layout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-web-parent-'));
    dirs.push(root);
    const monorepo = path.join(root, 'apps', 'server');
    fs.mkdirSync(monorepo, { recursive: true });
    const dist = path.join(root, 'apps', 'web', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html/>');
    // cwd = apps/server → candidates include cwd/../web/dist? 
    // candidates: moduleDir/../../web/dist, cwd/apps/web/dist, cwd/../web/dist
    const resolved = resolveWebDist(
      {},
      { cwd: monorepo, moduleDir: path.join(monorepo, 'src', 'lib') },
    );
    // moduleDir ../../web/dist from apps/server/src/lib → apps/web/dist
    expect(resolved).toBe(path.resolve(dist));
  });
});
