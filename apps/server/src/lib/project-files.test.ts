import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contentHash,
  detectEntryFile,
  listProjectFiles,
  projectFileSignatureChanged,
  readProjectFile,
  snapshotProjectFileSignatures,
  writeProjectFile,
  deleteProjectPath,
  mkdirProjectPath,
} from './project-files.js';
import { PathSandboxError } from './path-sandbox.js';

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-pfiles-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('project-files', () => {
  it('writes, lists, reads, detects entry, deletes', () => {
    const root = makeRoot();
    const w = writeProjectFile(root, 'index.html', '<html><body>hi</body></html>');
    expect(w.created).toBe(true);
    expect(w.hash).toBe(contentHash('<html><body>hi</body></html>'));
    expect(detectEntryFile(root)).toBe('index.html');

    writeProjectFile(root, 'css/app.css', 'body{}');
    mkdirProjectPath(root, 'assets');

    const list = listProjectFiles(root, { entryFile: 'index.html' });
    expect(list.some((e) => e.path === 'index.html' && e.isEntry)).toBe(true);
    expect(list.some((e) => e.path === 'css' && e.type === 'directory')).toBe(true);
    expect(list.some((e) => e.path === 'css/app.css')).toBe(true);

    const read = readProjectFile(root, 'index.html');
    expect(read.content).toContain('hi');

    const w2 = writeProjectFile(root, 'index.html', '<html>v2</html>');
    expect(w2.created).toBe(false);
    expect(w2.previousContent).toContain('hi');

    deleteProjectPath(root, 'css/app.css');
    expect(() => readProjectFile(root, 'css/app.css')).toThrow(PathSandboxError);
  });

  it('rejects traversal and oversized content', () => {
    const root = makeRoot();
    expect(() => writeProjectFile(root, '../x.txt', 'a')).toThrow(PathSandboxError);
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
    expect(() => writeProjectFile(root, 'big.txt', huge)).toThrow(/max size/i);
  });

  it('skips hidden and symlink entries in list', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'ok.txt'), '1');
    fs.writeFileSync(path.join(root, '.secret'), '2');
    fs.mkdirSync(path.join(root, 'node_modules'));
    const outside = makeRoot();
    fs.writeFileSync(path.join(outside, 'x'), 'y');
    fs.symlinkSync(path.join(outside, 'x'), path.join(root, 'link'));
    const list = listProjectFiles(root);
    expect(list.map((e) => e.path)).toEqual(['ok.txt']);
  });
});

describe('project-files additional coverage', () => {
  it('detectEntryFile finds nested candidates and returns null when missing', () => {
    const root = makeRoot();
    expect(detectEntryFile(root)).toBeNull();
    fs.mkdirSync(path.join(root, 'public'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public', 'index.html'), '<html></html>');
    expect(detectEntryFile(root)).toBe('public/index.html');
  });

  it('read rejects directories; mkdir creates nested; delete removes dirs', () => {
    const root = makeRoot();
    mkdirProjectPath(root, 'a/b');
    expect(fs.existsSync(path.join(root, 'a', 'b'))).toBe(true);
    expect(() => readProjectFile(root, 'a')).toThrow(/not a file|denied/i);

    writeProjectFile(root, 'a/b/c.txt', 'hi');
    deleteProjectPath(root, 'a/b/c.txt');
    deleteProjectPath(root, 'a/b');
    expect(fs.existsSync(path.join(root, 'a', 'b'))).toBe(false);
  });

  it('list respects maxEntries and missing root throws', () => {
    const root = makeRoot();
    for (let i = 0; i < 10; i++) {
      writeProjectFile(root, `f${i}.txt`, String(i));
    }
    const limited = listProjectFiles(root, { maxEntries: 3 });
    expect(limited.length).toBe(3);

    expect(() => listProjectFiles(path.join(root, 'missing-root'))).toThrow(/does not exist/i);
  });

  it('write rejects non-string content', () => {
    const root = makeRoot();
    expect(() =>
      writeProjectFile(root, 'x.txt', 42 as unknown as string),
    ).toThrow();
  });

  it('snapshot signatures hash content and ignore mtime-only touches', () => {
    const root = makeRoot();
    writeProjectFile(root, 'index.html', '<html>same</html>');
    const before = snapshotProjectFileSignatures(root, { hashContent: true });
    const sig = before.get('index.html');
    expect(sig?.hash).toBe(contentHash('<html>same</html>'));

    // mtime touch, same bytes
    const abs = path.join(root, 'index.html');
    const st = fs.statSync(abs);
    fs.utimesSync(abs, st.atime, new Date(st.mtimeMs + 120_000));

    const afterTouch = snapshotProjectFileSignatures(root, { hashContent: true });
    expect(projectFileSignatureChanged(sig, afterTouch.get('index.html')!)).toBe(false);

    writeProjectFile(root, 'index.html', '<html>changed</html>');
    const afterEdit = snapshotProjectFileSignatures(root, { hashContent: true });
    expect(projectFileSignatureChanged(sig, afterEdit.get('index.html')!)).toBe('modified');

    writeProjectFile(root, 'new.html', '<html>new</html>');
    const afterCreate = snapshotProjectFileSignatures(root, { hashContent: true });
    expect(projectFileSignatureChanged(undefined, afterCreate.get('new.html')!)).toBe('created');
  });
});
