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
