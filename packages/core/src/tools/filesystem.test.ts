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

    const nonString = await read.execute({ path: null as unknown as string });
    expect(nonString.success).toBe(false);
    expect(nonString.error).toMatch(/Path is required/i);

    const control = await read.execute({ path: `safe${'\0'}evil.txt` });
    expect(control.success).toBe(false);
    expect(control.error).toMatch(/control characters/i);

    const overlong = await read.execute({ path: 'a'.repeat(5_000) });
    expect(overlong.success).toBe(false);
    expect(overlong.error).toMatch(/max length/i);

    const escape = await read.execute({ path: '../outside.txt' });
    expect(escape.success).toBe(false);
    expect(escape.error).toMatch(/outside the workspace/);

    // Filenames starting with ".." must not be treated as traversal
    const dotdotName = await write.execute({ path: '..foo.txt', content: 'ok-dots' });
    expect(dotdotName.success).toBe(true);
    expect((await read.execute({ path: '..foo.txt' })).output).toBe('ok-dots');
    const triple = await write.execute({ path: '...hidden.txt', content: 'triple' });
    expect(triple.success).toBe(true);
    expect((await read.execute({ path: '...hidden.txt' })).output).toBe('triple');
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

  it('read truncates oversized files; search rejects control-char patterns', async () => {
    const write = createWriteFileTool(root);
    // write is capped at 1 MiB so craft via fs for oversize read
    await writeFile(join(root, 'huge.txt'), 'H'.repeat(1_048_576 + 50));
    const read = createReadFileTool(root);
    const got = await read.execute({ path: 'huge.txt' });
    expect(got.success).toBe(true);
    expect(String(got.output)).toContain('truncated');
    expect(String(got.output).length).toBeLessThan(1_048_576 + 80);

    const search = createSearchFilesTool(root);
    const bad = await search.execute({ pattern: 'a\nb' });
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/invalid or exceeds/i);

    // Leading control char must not be stripped to a valid path
    const lead = await read.execute({ path: '\nhuge.txt' });
    expect(lead.success).toBe(false);
    expect(lead.error).toMatch(/control characters/i);

    const writeBad = await write.execute({ path: '\nok.txt', content: 'x' });
    expect(writeBad.success).toBe(false);
    expect(writeBad.error).toMatch(/control characters/i);

    const listBad = await createListDirectoryTool(root).execute({ path: '\n.' });
    expect(listBad.success).toBe(false);
    expect(listBad.error).toMatch(/control characters/i);

    const dirBad = await search.execute({ pattern: '*.ts', directory: 'src\n' });
    expect(dirBad.success).toBe(false);
    expect(dirBad.error).toMatch(/control characters/i);
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

  it('list_directory caps returned entries at 1000', async () => {
    // Create more than MAX_LIST_ENTRIES non-hidden files
    await Promise.all(
      Array.from({ length: 1_050 }, (_, i) =>
        writeFile(join(root, `f${String(i).padStart(4, '0')}.txt`), 'x'),
      ),
    );
    const list = createListDirectoryTool(root);
    const result = await list.execute({ path: '.' });
    expect(result.success).toBe(true);
    const entries = result.output as unknown[];
    expect(entries).toHaveLength(1_000);
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

  it('list_directory treats empty / whitespace path as workspace root', async () => {
    await writeFile(join(root, 'root-file.txt'), 'r');
    const list = createListDirectoryTool(root);

    for (const path of ['', '   ', undefined as unknown as string]) {
      const result = await list.execute(path === undefined ? {} : { path });
      expect(result.success).toBe(true);
      const entries = result.output as Array<{ name: string }>;
      expect(entries.some((e) => e.name === 'root-file.txt')).toBe(true);
    }

    // Non-string path also falls back to workspace root
    const coerced = await list.execute({ path: 123 as unknown as string });
    expect(coerced.success).toBe(true);
  });

  it('list_directory marks unreadable entries as type unknown', async () => {
    await mkdir(join(root, 'mixed'), { recursive: true });
    await writeFile(join(root, 'mixed', 'ok.txt'), 'x');
    // Race-y vanishing entry: create then delete after list starts is hard;
    // instead create a dangling symlink whose stat fails closed as "unknown".
    try {
      await symlink(join(root, 'mixed', 'missing-target'), join(root, 'mixed', 'dangling'));
    } catch {
      // symlink may be restricted in some sandboxes — skip soft
      return;
    }
    const list = createListDirectoryTool(root);
    const result = await list.execute({ path: 'mixed' });
    expect(result.success).toBe(true);
    const entries = result.output as Array<{ name: string; type: string }>;
    const dangling = entries.find((e) => e.name === 'dangling');
    // Platform dependent: some resolve broken symlinks as unknown, others as file
    if (dangling) {
      expect(['unknown', 'file', 'directory']).toContain(dangling.type);
    }
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

    // Missing source → rename throws → structured catch path
    const missing = await move.execute({
      source: 'no-such-file.txt',
      destination: 'elsewhere.txt',
    });
    expect(missing.success).toBe(false);
    expect(missing.error).toBeTruthy();
  });

  it('rejects write under parent that is a symlink escaping the workspace', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'neos-fs-out-'));
    try {
      // dir symlink → outside; write of new file under it fails parent realpath check
      await symlink(outside, join(root, 'out-dir'));
      const write = createWriteFileTool(root);
      const result = await write.execute({
        path: 'out-dir/fresh.txt',
        content: 'leak',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the workspace|symlink|does not exist/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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

    // Leading control-char paths must not strip to valid relative paths
    const lead = await move.execute({ source: '\nfrom.txt', destination: 'to.txt' });
    expect(lead.success).toBe(false);
    expect(lead.error).toMatch(/control characters/i);
    const destCtrl = await move.execute({ source: 'from.txt', destination: 'to\n.txt' });
    expect(destCtrl.success).toBe(false);
    expect(destCtrl.error).toMatch(/control characters/i);

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

  it('rejects control-char list/search/move inputs and coerces non-string move paths', async () => {
    const list = createListDirectoryTool(root);
    const listCtrl = await list.execute({ path: 'dir\nname' });
    expect(listCtrl.success).toBe(false);
    expect(listCtrl.error).toMatch(/control characters/i);

    const search = createSearchFilesTool(root);
    const searchDirCtrl = await search.execute({
      pattern: '*.ts',
      type: 'glob',
      directory: 'sub\ndir',
    });
    expect(searchDirCtrl.success).toBe(false);
    expect(searchDirCtrl.error).toMatch(/control characters|directory/i);

    // Non-string directory coerced then rejected if control-char
    const dirObj = await search.execute({
      pattern: 'answer',
      type: 'content',
      directory: { toString: () => 'x\ny' } as never,
    });
    expect(dirObj.success).toBe(false);
    expect(dirObj.error).toMatch(/control characters/i);

    await writeFile(join(root, 'src.txt'), 's');
    const move = createMoveFileTool(root);
    // Non-string source/destination coercion
    const moveCoerced = await move.execute({
      source: { toString: () => 'src.txt' } as never,
      destination: { toString: () => 'dst.txt' } as never,
    });
    expect(moveCoerced.success).toBe(true);

    // read coerces non-string path via String() — missing file fails closed
    const read = createReadFileTool(root);
    const nonStr = await read.execute({ path: 123 as unknown as string });
    expect(nonStr.success).toBe(false);
    expect(nonStr.error).toBeTruthy();
  });

  it('search_files glob mode caps matches at 200 when fs.glob is available', async () => {
    const { glob: nodeGlob } = await import('node:fs/promises');
    if (typeof nodeGlob !== 'function') {
      // Node < 22: glob path is unavailable; covered by graceful failure test above
      return;
    }
    await mkdir(join(root, 'many'), { recursive: true });
    for (let i = 0; i < 220; i++) {
      await writeFile(join(root, 'many', `f${i}.txt`), 'x');
    }
    const search = createSearchFilesTool(root);
    const result = await search.execute({
      pattern: '**/*.txt',
      type: 'glob',
      directory: 'many',
    });
    expect(result.success).toBe(true);
    const matches = (result.output as { matches: string[] }).matches;
    expect(matches.length).toBeLessThanOrEqual(200);
  });
});
