import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getNativeExecutor } from '../registry.js';
import { registerCodingBlocks } from './index.js';
import type { BlockExecutionContext } from '../types.js';

function ctx(params: Record<string, unknown>, extras: Partial<BlockExecutionContext> = {}): BlockExecutionContext {
  return {
    params,
    inputs: {},
    settings: {},
    ...extras,
  };
}

beforeAll(() => {
  registerCodingBlocks();
});

describe('coding blocks', () => {
  describe('code_eval', () => {
    const exec = () => getNativeExecutor('code_eval')!;

    it('is registered', () => {
      expect(exec()).toBeDefined();
    });

    it('returns error when no code provided', async () => {
      const result = await exec().execute(ctx({ code: '' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No code/);
    });

    it('rejects whitespace-only code', async () => {
      const result = await exec().execute(ctx({ code: '   ' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No code/);
    });

    it('rejects oversized code payloads', async () => {
      const result = await exec().execute(ctx({ code: 'x'.repeat(100_001) }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/max length/i);
    });

    it('falls back unknown language to js', async () => {
      const result = await exec().execute(ctx({ code: '3 + 4', language: 'ruby' }));
      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('7');
    });

    it('evaluates simple JS expression', async () => {
      const result = await exec().execute(ctx({ code: '1 + 2', language: 'js' }));
      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('3');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('captures console.log output', async () => {
      const result = await exec().execute(
        ctx({ code: 'console.log("hello"); console.log("world")', language: 'js' }),
      );
      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('hello');
      expect(String(result.output)).toContain('world');
    });

    it('returns error for runtime throw', async () => {
      const result = await exec().execute(ctx({ code: 'throw new Error("boom")', language: 'js' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/boom/);
    });

    it('treats ts language like js (no transpile)', async () => {
      const result = await exec().execute(ctx({ code: '2 * 5', language: 'ts' }));
      expect(result.ok).toBe(true);
      expect(String(result.output)).toContain('10');
    });

    it('falls back unknown or whitespace language to js', async () => {
      const unknown = await exec().execute(ctx({ code: '3 + 4', language: 'ruby' }));
      expect(unknown.ok).toBe(true);
      expect(String(unknown.output)).toContain('7');

      const blank = await exec().execute(ctx({ code: '5 + 5', language: '   ' }));
      expect(blank.ok).toBe(true);
      expect(String(blank.output)).toContain('10');
    });

    it('runs python language via python3 -c when available', async () => {
      const result = await exec().execute(ctx({ code: 'print(1+1)', language: 'python' }));
      // python3 may be missing in some CI images — only assert structured result
      expect(typeof result.durationMs).toBe('number');
      if (result.ok) {
        expect(String(result.output)).toMatch(/2/);
      } else {
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('file_read / file_write path safety', () => {
    const read = () => getNativeExecutor('file_read')!;
    const write = () => getNativeExecutor('file_write')!;
    const workspaces = path.join(os.homedir(), '.config', 'neos-work', 'workspaces');
    const testRel = `_neos_test_${process.pid}`;
    const testFile = `${testRel}/sample.txt`;

    afterEach(async () => {
      await fs.rm(path.join(workspaces, testRel), { recursive: true, force: true }).catch(() => {});
    });

    it('rejects empty path for file_read', async () => {
      const result = await read().execute(ctx({ path: '' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No path/);
    });

    it('rejects whitespace-only path for file_read', async () => {
      const result = await read().execute(ctx({ path: '   ' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No path/);
    });

    it('returns error when relative file does not exist', async () => {
      const result = await read().execute(ctx({ path: `${testRel}/missing-file.txt` }));
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('rejects absolute path for file_read', async () => {
      const result = await read().execute(ctx({ path: '/etc/passwd' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/unsafe|Invalid/i);
    });

    it('rejects path traversal for file_read', async () => {
      const result = await read().execute(ctx({ path: '../../../etc/passwd' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/unsafe|Invalid/i);
    });

    it('rejects empty path for file_write', async () => {
      const result = await write().execute(ctx({ path: '', content: 'x' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No path/);
    });

    it('rejects absolute write path', async () => {
      const result = await write().execute(ctx({ path: '/tmp/evil.txt', content: 'nope' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/workspaces|relative/i);
    });

    it('rejects oversized write content', async () => {
      const result = await write().execute(
        ctx({ path: testFile, content: 'x'.repeat(2 * 1024 * 1024 + 1) }),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/max length/i);
    });

    it('rejects directory path and oversized files on file_read', async () => {
      const dirRel = `${testRel}/subdir`;
      await fs.mkdir(path.join(workspaces, dirRel), { recursive: true });
      const dirResult = await read().execute(ctx({ path: dirRel }));
      expect(dirResult.ok).toBe(false);
      expect(dirResult.error).toMatch(/not a file/i);

      // Write a >2MiB file directly (bypass file_write max) to exercise file_read size guard
      const bigRel = `${testRel}/big.bin`;
      const bigAbs = path.join(workspaces, bigRel);
      await fs.mkdir(path.dirname(bigAbs), { recursive: true });
      const fh = await fs.open(bigAbs, 'w');
      try {
        await fh.write(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
      } finally {
        await fh.close();
      }
      const bigResult = await read().execute(ctx({ path: bigRel }));
      expect(bigResult.ok).toBe(false);
      expect(bigResult.error).toMatch(/max size/i);
    });

    it('writes then reads a relative workspace file', async () => {
      const writeResult = await write().execute(ctx({ path: testFile, content: 'coverage-payload' }));
      expect(writeResult.ok).toBe(true);
      expect(writeResult.output).toBe(true);

      const readResult = await read().execute(ctx({ path: `  ${testFile}  ` }));
      expect(readResult.ok).toBe(true);
      expect(readResult.output).toBe('coverage-payload');
    });
  });

  describe('test_runner allowlist', () => {
    const runner = () => getNativeExecutor('test_runner')!;

    it('rejects empty command', async () => {
      const result = await runner().execute(ctx({ command: '   ' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/No command/);
    });

    it('rejects non-allowlisted binary', async () => {
      const result = await runner().execute(ctx({ command: 'rm -rf /' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not in allowed list/);
    });

    it('allows pnpm with a no-op style invocation failure still structured', async () => {
      // Use `pnpm --version` which should exit 0 if pnpm is available
      const result = await runner().execute(ctx({ command: 'pnpm --version' }));
      expect(result.meta).toBeDefined();
      expect(typeof result.meta?.exitCode).toBe('number');
      // If pnpm exists, ok true; if not, ok false with exit -1 or nonzero — either is valid coverage
      expect(result.output !== undefined || result.error !== undefined).toBe(true);
    });

    it('allows path-qualified allowlisted binary names', async () => {
      const result = await runner().execute(ctx({ command: '/usr/bin/npm --version' }));
      // binary ends with /npm → allowlisted; may fail if path missing, but must not be allowlist error
      if (result.error) {
        expect(result.error).not.toMatch(/not in allowed list/);
      }
      expect(result.meta === undefined || typeof result.meta?.exitCode === 'number').toBe(true);
    });

    it('allows go and cargo prefixes for structured failures', async () => {
      for (const command of ['go version', 'cargo --version']) {
        const result = await runner().execute(ctx({ command }));
        if (result.error) {
          expect(result.error).not.toMatch(/not in allowed list/);
        }
      }
    });
  });

  describe('git_diff', () => {
    const git = () => getNativeExecutor('git_diff')!;

    it('rejects absolute path outside home', async () => {
      const result = await git().execute(ctx({ repoPath: '/var/empty' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/home directory/);
    });

    it('treats whitespace-only repoPath as cwd', async () => {
      const result = await git().execute(ctx({ repoPath: '   ' }));
      expect(typeof result.durationMs).toBe('number');
      // Should not fail the home-directory guard
      if (result.error) {
        expect(result.error).not.toMatch(/home directory/);
      }
    });

    it('runs git diff in current repo (may be empty)', async () => {
      const result = await git().execute(ctx({ repoPath: process.cwd() }));
      // repo is a git checkout; either success with diff text or structured failure
      expect(typeof result.durationMs).toBe('number');
      if (result.ok) {
        expect(typeof result.output).toBe('string');
      } else {
        expect(result.error).toBeTruthy();
      }
    });
  });

  describe('test_runner cwd hygiene', () => {
    const runner = () => getNativeExecutor('test_runner')!;

    it('rejects absolute cwd outside home (not process.cwd)', async () => {
      const result = await runner().execute(ctx({ command: 'pnpm --version', cwd: '/var/empty' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/home directory/);
    });

    it('treats whitespace-only cwd as process.cwd', async () => {
      const result = await runner().execute(ctx({ command: 'pnpm --version', cwd: '   ' }));
      // Must not hit the home-directory guard
      if (result.error) {
        expect(result.error).not.toMatch(/home directory/);
      }
      expect(result.meta === undefined || typeof result.meta?.exitCode === 'number').toBe(true);
    });
  });
});
