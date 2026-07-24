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

    const padded = await write.execute({ path: '  pad.txt  ', content: 'p' });
    expect(padded.success).toBe(true);
    expect((await read.execute({ path: '  pad.txt  ' })).output).toBe('p');

    const blank = await read.execute({ path: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/Path is required/i);

    const control = await read.execute({ path: `safe${'\0'}evil.txt` });
    expect(control.success).toBe(false);
    expect(control.error).toMatch(/control characters/i);

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

  it('rejects blank search pattern and whitespace-only directory filter', async () => {
    const search = createSearchFilesTool(root);
    const blank = await search.execute({ pattern: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/pattern is required/i);

    const blankDir = await search.execute({ pattern: 'x', directory: '   ' });
    expect(blankDir.success).toBe(false);
    expect(blankDir.error).toMatch(/directory is required/i);
  });

  it('blocks .git and .ssh protected write/move paths', async () => {
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, '.ssh'), { recursive: true });
    const write = createWriteFileTool(root);
    const git = await write.execute({ path: '.git/config', content: 'x' });
    expect(git.success).toBe(false);
    expect(git.error).toMatch(/protected path/);

    const ssh = await write.execute({ path: '.ssh/id_rsa', content: 'x' });
    expect(ssh.success).toBe(false);
    expect(ssh.error).toMatch(/protected path/);

    await writeFile(join(root, 'ok.txt'), 'data');
    const move = createMoveFileTool(root);
    const toGit = await move.execute({ source: 'ok.txt', destination: '.git/config' });
    expect(toGit.success).toBe(false);
    expect(toGit.error).toMatch(/protected path/);
  });

  it('requires source and destination for move_file', async () => {
    const move = createMoveFileTool(root);
    const missing = await move.execute({ source: '', destination: 'x' });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/source and destination/i);

    const blank = await move.execute({ source: 'a', destination: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/source and destination/i);
  });

  it('coerces non-string write content and list defaults to workspace root', async () => {
    const write = createWriteFileTool(root);
    const written = await write.execute({
      path: 'num.txt',
      content: 123 as unknown as string,
    });
    expect(written.success).toBe(true);

    const read = createReadFileTool(root);
    expect((await read.execute({ path: 'num.txt' })).output).toBe('123');

    await writeFile(join(root, 'root-only.txt'), 'r');
    const list = createListDirectoryTool(root);
    const result = await list.execute({});
    expect(result.success).toBe(true);
    const names = (result.output as Array<{ name: string }>).map((e) => e.name);
    expect(names).toContain('root-only.txt');
  });

  it('search_files content mode respects subdirectory filter', async () => {
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'nested', 'hit.ts'), 'const secret = 1;\n');
    await writeFile(join(root, 'miss.ts'), 'const secret = 2;\n');

    const search = createSearchFilesTool(root);
    const result = await search.execute({
      pattern: 'secret',
      type: 'content',
      directory: 'nested',
    });
    expect(result.success).toBe(true);
    const matches = (result.output as { matches: Array<{ file: string }> }).matches;
    expect(matches.some((m) => m.file.includes('hit.ts'))).toBe(true);
    expect(matches.every((m) => !m.file.endsWith('miss.ts') || m.file.includes('nested'))).toBe(
      true,
    );
  });
});
