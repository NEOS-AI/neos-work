import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * On Node < 22, node:fs/promises.glob is undefined, so the real search_files
 * glob branch is never exercised. Provide a synthetic async iterable glob so
 * the for-await + 200-cap path is covered.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async *glob(_pattern: string, _opts?: { cwd?: string }) {
      for (let i = 0; i < 250; i++) {
        yield `f${i}.txt`;
      }
    },
  };
});

// realpathSync is still from node:fs (sync) — workspace root validation works.
const { createSearchFilesTool } = await import('./filesystem.js');

describe('search_files glob (mocked fs.glob)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neos-glob-'));
    await mkdir(join(root, 'many'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('caps matches at 200 via for-await break', async () => {
    const search = createSearchFilesTool(root);
    const result = await search.execute({
      pattern: '**/*.txt',
      type: 'glob',
      directory: 'many',
    });
    // directory "many" may not exist as realpath if empty... we created it
    expect(result.success).toBe(true);
    const matches = (result.output as { matches: string[] }).matches;
    expect(matches).toHaveLength(200);
    expect(matches[0]).toBe('f0.txt');
    expect(matches[199]).toBe('f199.txt');
  });

  it('returns matches for workspace-root glob without directory', async () => {
    const search = createSearchFilesTool(root);
    const result = await search.execute({ pattern: '*.md', type: 'glob' });
    expect(result.success).toBe(true);
    expect((result.output as { matches: string[] }).matches).toHaveLength(200);
  });
});
