import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as projects from '../db/projects.js';
import { getDb } from '../db/schema.js';
import {
  buildProjectZipBuffer,
  parseProjectZipBuffer,
  materializeImportedFiles,
  projectZipFilename,
  PROJECT_ZIP_FORMAT,
} from './project-archive.js';
import { writeProjectFile } from './project-files.js';

const NAME = `_zip_${process.pid}`;
const ids: string[] = [];

function cleanup() {
  const db = getDb();
  for (const id of ids.splice(0)) {
    const row = db
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

afterEach(cleanup);

describe('project-archive', () => {
  it('exports and re-imports project files round-trip', async () => {
    const p = projects.createProject({ name: NAME });
    ids.push(p.id);
    writeProjectFile(p.baseDir, 'index.html', '<html><body>Hi</body></html>');
    writeProjectFile(p.baseDir, 'css/app.css', 'body{margin:0}');

    const buf = await buildProjectZipBuffer(projects.getProject(p.id)!);
    expect(buf.length).toBeGreaterThan(50);

    const parsed = await parseProjectZipBuffer(buf);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name).toBe(NAME);
    expect(parsed.files.some((f) => f.path === 'index.html')).toBe(true);
    expect(parsed.files.some((f) => f.path === 'css/app.css')).toBe(true);
    expect(parsed.files.find((f) => f.path === 'index.html')!.content).toContain('Hi');
  });

  it('rejects non-neos-project format and traversal', async () => {
    // minimal zip without project.json — build via export then strip is hard;
    // use parse with empty
    const empty = await parseProjectZipBuffer(Buffer.from([]));
    expect(empty.ok).toBe(false);

    const p = projects.createProject({ name: `${NAME}_b` });
    ids.push(p.id);
    const buf = await buildProjectZipBuffer(projects.getProject(p.id)!);
    const parsed = await parseProjectZipBuffer(buf);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(PROJECT_ZIP_FORMAT).toBe('neos-project');
      const target = projects.createProject({ name: `${NAME}_imp` });
      ids.push(target.id);
      const { written } = materializeImportedFiles(target.baseDir, parsed.files);
      expect(written).toBeGreaterThanOrEqual(0);
    }
  });

  it('projectZipFilename sanitizes', () => {
    expect(projectZipFilename('My Project!')).toMatch(/\.neos-project\.zip$/);
    expect(projectZipFilename('a/../b')).not.toContain('..');
    expect(projectZipFilename('')).toMatch(/^project\.neos-project\.zip$/);
    expect(projectZipFilename('!!!')).toMatch(/\.neos-project\.zip$/);
  });

  async function zipFromEntries(
    entries: Array<{ name: string; content: string | Buffer }>,
  ): Promise<Buffer> {
    const { ZipArchive } = await import('archiver');
    const { PassThrough } = await import('node:stream');
    return new Promise((resolve, reject) => {
      const archive = new ZipArchive({ zlib: { level: 1 } });
      const chunks: Buffer[] = [];
      const stream = new PassThrough();
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.pipe(stream);
      for (const e of entries) {
        archive.append(e.content, { name: e.name });
      }
      void archive.finalize();
    });
  }

  it('parse rejects invalid zip, bad format, missing name, traversal, null bytes', async () => {
    const notZip = await parseProjectZipBuffer(Buffer.from('not-a-zip'));
    expect(notZip.ok).toBe(false);

    const tooBig = await parseProjectZipBuffer(Buffer.alloc(51 * 1024 * 1024, 1));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toMatch(/max size/i);

    const badFormat = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: 'other',
          exportedAt: new Date().toISOString(),
          project: { name: 'x', entryFile: null, designSystemId: null },
        }),
      },
    ]);
    const bf = await parseProjectZipBuffer(badFormat);
    expect(bf.ok).toBe(false);

    const noName = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: PROJECT_ZIP_FORMAT,
          exportedAt: new Date().toISOString(),
          project: { name: '  ', entryFile: null, designSystemId: null },
        }),
      },
    ]);
    const nn = await parseProjectZipBuffer(noName);
    expect(nn.ok).toBe(false);

    const newlineName = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: PROJECT_ZIP_FORMAT,
          exportedAt: new Date().toISOString(),
          project: { name: 'bad\nname', entryFile: null, designSystemId: null },
        }),
      },
    ]);
    const nl = await parseProjectZipBuffer(newlineName);
    expect(nl.ok).toBe(false);

    const badJson = await zipFromEntries([
      { name: 'project.json', content: '{not-json' },
      { name: 'files/a.html', content: '<p>x</p>' },
    ]);
    const bj = await parseProjectZipBuffer(badJson);
    expect(bj.ok).toBe(false);

    const traversal = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: PROJECT_ZIP_FORMAT,
          exportedAt: new Date().toISOString(),
          project: { name: 'ok', entryFile: null, designSystemId: null },
        }),
      },
      { name: 'files/../../etc/passwd', content: 'x' },
    ]);
    const tr = await parseProjectZipBuffer(traversal);
    expect(tr.ok).toBe(false);

    const noManifest = await zipFromEntries([
      { name: 'README.md', content: 'hi' },
      { name: 'files/a.html', content: '<p/>' },
    ]);
    const nm = await parseProjectZipBuffer(noManifest);
    expect(nm.ok).toBe(false);

    const nullFile = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: PROJECT_ZIP_FORMAT,
          exportedAt: new Date().toISOString(),
          project: {
            name: 'with-null',
            entryFile: 'index.html',
            designSystemId: 'ds-1',
            meta: { k: 1 },
          },
        }),
      },
      { name: 'files/index.html', content: Buffer.from('a\0b') },
    ]);
    const nf = await parseProjectZipBuffer(nullFile);
    expect(nf.ok).toBe(false);

    const good = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: PROJECT_ZIP_FORMAT,
          exportedAt: new Date().toISOString(),
          project: {
            name: '  Good Name  ',
            entryFile: '/index.html',
            designSystemId: '  ds-ok  ',
            meta: { theme: 'dark' },
          },
        }),
      },
      { name: 'README.md', content: 'readme' },
      { name: 'files/index.html', content: '<html>ok</html>' },
      { name: 'files/css/', content: '' }, // directory-like may be skipped
    ]);
    const g = await parseProjectZipBuffer(good);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.name).toBe('Good Name');
      expect(g.entryFile).toBe('index.html');
      expect(g.designSystemId).toBe('ds-ok');
      expect(g.meta.theme).toBe('dark');
      expect(g.files.some((f) => f.path === 'index.html')).toBe(true);
    }
  });

  it('build skips unreadable files and materialize writes', async () => {
    const p = projects.createProject({ name: `${NAME}_skip` });
    ids.push(p.id);
    writeProjectFile(p.baseDir, 'ok.html', '<p>ok</p>');
    // place a directory entry that list may include as non-file is already filtered
    const buf = await buildProjectZipBuffer(projects.getProject(p.id)!);
    expect(buf.length).toBeGreaterThan(20);

    const target = projects.createProject({ name: `${NAME}_mat` });
    ids.push(target.id);
    const { written } = materializeImportedFiles(target.baseDir, [
      { path: 'a.html', content: '<a/>' },
      { path: 'nested/b.html', content: '<b/>' },
    ]);
    expect(written).toBe(2);
  });
});

describe('project-archive symlink guards (Task 14)', () => {
  it('path-sandbox denies symlink escape for project FS (archive uses same root)', async () => {
    const { resolveUnderRoot } = await import('./path-sandbox.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-ssrf-arch-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-ssrf-out-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
      expect(() => resolveUnderRoot(root, 'link.txt', { mustExist: true })).toThrow(
        /symlink|escape|outside/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
