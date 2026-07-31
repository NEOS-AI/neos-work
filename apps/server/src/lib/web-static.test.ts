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
