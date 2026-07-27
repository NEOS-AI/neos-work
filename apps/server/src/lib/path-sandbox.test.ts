import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PathSandboxError,
  defaultDataDir,
  defaultProjectsRoot,
  isPathInsideRoot,
  normalizeProjectRelativePath,
  resolveUnderRoot,
  validateImportBaseDir,
} from './path-sandbox.js';

const tmpDirs: string[] = [];

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-sandbox-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('normalizeProjectRelativePath', () => {
  it('normalizes relative paths', () => {
    expect(normalizeProjectRelativePath('index.html')).toBe('index.html');
    expect(normalizeProjectRelativePath('./src/app.js')).toBe('src/app.js');
    expect(normalizeProjectRelativePath('a//b/c')).toBe('a/b/c');
  });

  it('rejects traversal and absolute', () => {
    expect(() => normalizeProjectRelativePath('../x')).toThrow(PathSandboxError);
    expect(() => normalizeProjectRelativePath('/etc/passwd')).toThrow(PathSandboxError);
    expect(() => normalizeProjectRelativePath('a/../../b')).toThrow(PathSandboxError);
    expect(() => normalizeProjectRelativePath('a\0b')).toThrow(PathSandboxError);
    expect(() => normalizeProjectRelativePath('')).toThrow(PathSandboxError);
  });
});

describe('resolveUnderRoot', () => {
  it('resolves files inside root', () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    const r = resolveUnderRoot(root, 'index.html', { mustExist: true });
    expect(r.relative).toBe('index.html');
    expect(r.absolute).toBe(fs.realpathSync(path.join(root, 'index.html')));
  });

  it('denies path escape', () => {
    const root = makeTempRoot();
    expect(() => resolveUnderRoot(root, '../outside.txt')).toThrow(/traversal|escape/i);
  });

  it('denies symlink escape', () => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    expect(() => resolveUnderRoot(root, 'link.txt', { mustExist: true })).toThrow(
      /symlink escapes/i,
    );
  });

  it('allows write path for new file under root', () => {
    const root = makeTempRoot();
    const r = resolveUnderRoot(root, 'pages/new.html');
    expect(r.relative).toBe('pages/new.html');
    expect(r.absolute.startsWith(fs.realpathSync(root))).toBe(true);
  });
});

describe('isPathInsideRoot / validateImportBaseDir', () => {
  it('detects containment', () => {
    const root = makeTempRoot();
    fs.mkdirSync(path.join(root, 'sub'));
    expect(isPathInsideRoot(root, path.join(root, 'sub'))).toBe(true);
    expect(isPathInsideRoot(root, makeTempRoot())).toBe(false);
  });

  it('validates import baseDir under tmp/home', () => {
    const root = makeTempRoot();
    expect(validateImportBaseDir(root)).toBe(fs.realpathSync(root));
    expect(() => validateImportBaseDir('/')).toThrow(/root/i);
    expect(() => validateImportBaseDir(path.join(root, 'missing'))).toThrow(/exist/i);
  });

  it('denies dataDir root and non-projects children as baseDir', () => {
    const dataDir = makeTempRoot();
    fs.mkdirSync(path.join(dataDir, 'projects'));
    fs.mkdirSync(path.join(dataDir, 'secrets'));
    expect(() => validateImportBaseDir(dataDir, { dataDir })).toThrow(/data directory/i);
    expect(() =>
      validateImportBaseDir(path.join(dataDir, 'secrets'), { dataDir }),
    ).toThrow(/internal data/i);
    // Designated projects tree is allowed
    const ok = validateImportBaseDir(path.join(dataDir, 'projects'), { dataDir });
    expect(ok).toBe(fs.realpathSync(path.join(dataDir, 'projects')));
  });

  it('defaultProjectsRoot is absolute', () => {
    expect(path.isAbsolute(defaultProjectsRoot())).toBe(true);
  });
});

describe('path-sandbox edge cases', () => {
  it('normalize rejects non-string, overlong, win absolute, url, trailing slash empty', () => {
    expect(() => normalizeProjectRelativePath(42 as unknown as string)).toThrow(/string/i);
    expect(() => normalizeProjectRelativePath('p'.repeat(1_001))).toThrow(/max length/i);
    expect(() => normalizeProjectRelativePath('C:\\Windows\\system32')).toThrow(/absolute|outside/i);
    expect(() => normalizeProjectRelativePath('https://evil.example/x')).toThrow(/absolute|outside/i);
    expect(() => normalizeProjectRelativePath('   ')).toThrow(/required/i);
    expect(() => normalizeProjectRelativePath('.')).toThrow(/required/i);
    expect(() => normalizeProjectRelativePath('a/./b')).toThrow(/traversal|outside/i);
  });

  it('resolveUnderRoot rejects invalid root and missing mustExist path', () => {
    expect(() => resolveUnderRoot('', 'a.txt')).toThrow(/invalid project root|denied/i);
    expect(() => resolveUnderRoot('root\n', 'a.txt')).toThrow(/invalid project root|denied/i);
    expect(() => resolveUnderRoot('r'.repeat(5_000), 'a.txt')).toThrow(/too long|denied/i);

    const missingRoot = path.join(os.tmpdir(), `neos-missing-root-${process.pid}`);
    expect(() => resolveUnderRoot(missingRoot, 'a.txt')).toThrow(/does not exist|not_found/i);

    const root = makeTempRoot();
    expect(() => resolveUnderRoot(root, 'nope.txt', { mustExist: true })).toThrow(/not found/i);
  });

  it('resolveUnderRoot allows existing non-escaping symlink', () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, 'real.txt'), 'ok');
    fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'link-ok.txt'));
    const r = resolveUnderRoot(root, 'link-ok.txt');
    expect(r.relative).toBe('link-ok.txt');
    expect(fs.readFileSync(r.absolute, 'utf8')).toBe('ok');
  });

  it('isPathInsideRoot returns false for invalid inputs', () => {
    expect(isPathInsideRoot('/no/such/root-xyz', '/tmp')).toBe(false);
  });

  it('validateImportBaseDir rejects non-directory and supports requireExists false', () => {
    const root = makeTempRoot();
    const file = path.join(root, 'file.txt');
    fs.writeFileSync(file, 'x');
    expect(() => validateImportBaseDir(file)).toThrow(/directory/i);

    // Use realpath form so home/tmp containment matches on macOS (/var vs /private/var)
    const missing = path.join(fs.realpathSync(root), 'future-dir');
    const resolved = validateImportBaseDir(missing, { requireExists: false });
    expect(path.resolve(resolved)).toBe(path.resolve(missing));

    expect(() => validateImportBaseDir('base\ndir')).toThrow(/invalid baseDir/i);
    expect(() => validateImportBaseDir('')).toThrow(/invalid baseDir/i);
  });

  it('defaultProjectsRoot / defaultDataDir honor env overrides', () => {
    const prevProjects = process.env.NEOS_PROJECTS_DIR;
    const prevData = process.env.NEOS_DATA_DIR;
    try {
      process.env.NEOS_PROJECTS_DIR = path.join(os.tmpdir(), 'neos-projects-env');
      expect(defaultProjectsRoot()).toBe(path.resolve(process.env.NEOS_PROJECTS_DIR));

      delete process.env.NEOS_PROJECTS_DIR;
      process.env.NEOS_DATA_DIR = path.join(os.tmpdir(), 'neos-data-env');
      expect(defaultProjectsRoot()).toBe(
        path.join(path.resolve(process.env.NEOS_DATA_DIR), 'projects'),
      );
      expect(defaultDataDir()).toBe(path.resolve(process.env.NEOS_DATA_DIR));

      // control-char env ignored
      process.env.NEOS_DATA_DIR = 'bad\ndata';
      process.env.NEOS_PROJECTS_DIR = 'bad\nprojects';
      expect(defaultProjectsRoot()).toMatch(/neos-work|projects/);
      expect(defaultDataDir()).toMatch(/neos-work/);
    } finally {
      if (prevProjects === undefined) delete process.env.NEOS_PROJECTS_DIR;
      else process.env.NEOS_PROJECTS_DIR = prevProjects;
      if (prevData === undefined) delete process.env.NEOS_DATA_DIR;
      else process.env.NEOS_DATA_DIR = prevData;
    }
  });
});
