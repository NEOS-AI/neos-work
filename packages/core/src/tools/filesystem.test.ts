import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFilesystemTools,
  createListDirectoryTool,
  createMoveFileTool,
  createReadFileTool,
  createSearchFilesTool,
  createWriteFileTool,
} from './filesystem.js';

describe('filesystem tools', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neos-fs-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('createFilesystemTools returns five tools', () => {
    expect(createFilesystemTools(root).map((t) => t.name)).toEqual([
      'read_file',
      'write_file',
      'list_directory',
      'search_files',
      'move_file',
    ]);
  });

  it('read/write round-trip and rejects path traversal', async () => {
    const write = createWriteFileTool(root);
    const read = createReadFileTool(root);

    const written = await write.execute({ path: 'notes.txt', content: 'hello' });
    expect(written.success).toBe(true);

    const got = await read.execute({ path: 'notes.txt' });
    expect(got.success).toBe(true);
    expect(got.output).toBe('hello');

    const escape = await read.execute({ path: '../outside.txt' });
    expect(escape.success).toBe(false);
    expect(escape.error).toMatch(/outside the workspace/);
  });

  it('write rejects oversized content and protected .env paths', async () => {
    const write = createWriteFileTool(root);
    const huge = await write.execute({ path: 'big.txt', content: 'x'.repeat(1_048_577) });
    expect(huge.success).toBe(false);
    expect(huge.error).toMatch(/max size/);

    const env = await write.execute({ path: '.env', content: 'SECRET=1' });
    expect(env.success).toBe(false);
    expect(env.error).toMatch(/protected path/);
  });

  it('list_directory skips hidden entries', async () => {
    await writeFile(join(root, 'visible.txt'), 'v');
    await writeFile(join(root, '.hidden'), 'h');
    const list = createListDirectoryTool(root);
    const result = await list.execute({ path: '.' });
    expect(result.success).toBe(true);
    const names = (result.output as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain('visible.txt');
    expect(names).not.toContain('.hidden');
  });

  it('search_files supports content mode and validates regex', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const answer = 42;\n');
    await writeFile(join(root, 'src', 'b.md'), 'no match');

    const search = createSearchFilesTool(root);

    const contentResult = await search.execute({ pattern: 'answer', type: 'content' });
    expect(contentResult.success).toBe(true);
    const matches = (contentResult.output as { matches: Array<{ file: string }> }).matches;
    expect(matches.some((m) => m.file.includes('a.ts'))).toBe(true);

    const badRegex = await search.execute({ pattern: '(', type: 'content' });
    expect(badRegex.success).toBe(false);
    expect(badRegex.error).toMatch(/Invalid regex/);

    // Glob uses node:fs/promises.glob (Node >= 22). On older runtimes it fails gracefully.
    const globResult = await search.execute({ pattern: '**/*.ts', type: 'glob' });
    if (typeof (await import('node:fs/promises')).glob === 'function') {
      expect(globResult.success).toBe(true);
      expect(
        (globResult.output as { matches: string[] }).matches.some((m) => m.endsWith('a.ts')),
      ).toBe(true);
    } else {
      expect(globResult.success).toBe(false);
      expect(globResult.error).toBeTruthy();
    }
  });

  it('move_file renames within workspace and blocks protected sources', async () => {
    await writeFile(join(root, 'from.txt'), 'data');
    const move = createMoveFileTool(root);
    const ok = await move.execute({ source: 'from.txt', destination: 'to.txt' });
    expect(ok.success).toBe(true);

    await writeFile(join(root, '.env.local'), 'x=1');
    const blocked = await move.execute({ source: '.env.local', destination: 'leaked' });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/protected path/);
  });

  it('write blocks .pem/.key and missing parent directory', async () => {
    const write = createWriteFileTool(root);

    const pem = await write.execute({ path: 'cert.pem', content: '-----' });
    expect(pem.success).toBe(false);
    expect(pem.error).toMatch(/protected path/);

    const key = await write.execute({ path: 'id_rsa.key', content: 'secret' });
    expect(key.success).toBe(false);
    expect(key.error).toMatch(/protected path/);

    const missingParent = await write.execute({
      path: 'no-such-dir/nested.txt',
      content: 'x',
    });
    expect(missingParent.success).toBe(false);
    expect(missingParent.error).toMatch(/does not exist|outside/);
  });

  it('list_directory fails for missing path and reports directory type', async () => {
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'sub', 'file.txt'), 'hi');

    const list = createListDirectoryTool(root);
    const ok = await list.execute({ path: 'sub' });
    expect(ok.success).toBe(true);
    const entries = ok.output as Array<{ name: string; type: string; size?: number }>;
    expect(entries.some((e) => e.name === 'file.txt' && e.type === 'file' && e.size === 2)).toBe(
      true,
    );

    const missing = await list.execute({ path: 'does-not-exist' });
    expect(missing.success).toBe(false);
    expect(missing.error).toBeTruthy();
  });

  it('search_files rejects missing and outside directories', async () => {
    const search = createSearchFilesTool(root);

    const missing = await search.execute({
      pattern: 'x',
      type: 'content',
      directory: 'nope',
    });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/does not exist/);

    const outside = await search.execute({
      pattern: 'x',
      type: 'content',
      directory: '..',
    });
    expect(outside.success).toBe(false);
    expect(outside.error).toMatch(/outside the workspace/);
  });

  it('move_file blocks protected destination and outside destination', async () => {
    await writeFile(join(root, 'src.txt'), 'data');
    const move = createMoveFileTool(root);

    const protectedDest = await move.execute({
      source: 'src.txt',
      destination: '.env.production',
    });
    expect(protectedDest.success).toBe(false);
    expect(protectedDest.error).toMatch(/protected path/);

    const outside = await move.execute({
      source: 'src.txt',
      destination: '../outside.txt',
    });
    expect(outside.success).toBe(false);
    expect(outside.error).toMatch(/outside the workspace/);
  });

  it('blocks symlink escape when reading through a link outside the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'neos-fs-out-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'leak');
      await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));

      const read = createReadFileTool(root);
      const result = await read.execute({ path: 'link.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace|symlink/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
