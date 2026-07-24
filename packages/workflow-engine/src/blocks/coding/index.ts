/**
 * Coding domain blocks — code_eval, file_read, file_write, git_diff, test_runner.
 *
 * Security notes:
 * - code_eval: vm.runInNewContext with 5s timeout, no module access
 * - file_read/file_write: path traversal prevention, write restricted to workspaces dir
 * - git_diff: read-only, uses spawn not exec
 * - test_runner: allowed command prefix allowlist
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { registerNativeBlock } from '../registry.js';
import type { BlockExecutionContext, BlockResult } from '../types.js';

const WORKSPACES_DIR = path.join(os.homedir(), '.config', 'neos-work', 'workspaces');
const ALLOWED_TEST_PREFIXES = ['npm', 'pnpm', 'yarn', 'pytest', 'go', 'cargo'];
const CODE_EVAL_TIMEOUT_MS = 5000;
/** Prevent pathological payloads (plan Task 12 coding blocks). */
const CODE_EVAL_MAX_CHARS = 100_000;
const FILE_READ_MAX_BYTES = 2 * 1024 * 1024;
const FILE_WRITE_MAX_CHARS = 2 * 1024 * 1024;

// ── Helpers ──────────────────────────────────────────────────────────────────

function safePath(inputPath: string, baseDir?: string): string | null {
  const trimmed = typeof inputPath === 'string' ? inputPath.trim() : '';
  if (!trimmed) return null;
  // Reject absolute paths or traversal attempts
  if (path.isAbsolute(trimmed)) return null;
  const base = baseDir ?? WORKSPACES_DIR;
  const resolved = path.resolve(base, trimmed);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return null;
  }
  return resolved;
}

function runSpawn(
  bin: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    child.stdout?.on('data', (d: Buffer) => { output += d.toString('utf8'); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString('utf8'); });

    const timeout = opts.timeoutMs
      ? setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } }, opts.timeoutMs)
      : null;

    const abortHandler = () => { try { child.kill('SIGTERM'); } catch { /* ignore */ } };
    opts.signal?.addEventListener('abort', abortHandler, { once: true });

    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', abortHandler);
      reject(err);
    });

    child.on('exit', (code) => {
      if (timeout) clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', abortHandler);
      resolve({ output, exitCode: code });
    });
  });
}

// ── code_eval ─────────────────────────────────────────────────────────────────

const CODE_LANGUAGES = new Set(['js', 'ts', 'python']);

async function executeCodeEval(ctx: BlockExecutionContext): Promise<BlockResult> {
  const start = Date.now();
  const code = String(ctx.params['code'] ?? '');
  const rawLanguage = String(ctx.params['language'] ?? 'js').trim().toLowerCase();
  // Unknown / whitespace language → js (matches paramDefs options)
  const language = CODE_LANGUAGES.has(rawLanguage) ? rawLanguage : 'js';

  if (!code.trim()) {
    return { ok: false, output: null, error: 'No code provided', durationMs: Date.now() - start };
  }
  if (code.length > CODE_EVAL_MAX_CHARS) {
    return {
      ok: false,
      output: null,
      error: `Code exceeds max length (${CODE_EVAL_MAX_CHARS} characters)`,
      durationMs: Date.now() - start,
    };
  }

  if (language === 'python') {
    // Python: spawn python3 -c "<code>"
    const result = await runSpawn('python3', ['-c', code], {
      signal: ctx.signal,
      timeoutMs: CODE_EVAL_TIMEOUT_MS,
    }).catch((err) => ({ output: String(err), exitCode: -1 }));

    return {
      ok: result.exitCode === 0,
      output: result.output,
      error: result.exitCode !== 0 ? `Python exited with code ${result.exitCode}` : undefined,
      durationMs: Date.now() - start,
    };
  }

  // JavaScript / TypeScript: vm.runInNewContext
  try {
    // Dynamic import to avoid bundling in browser contexts
    const vm = createRequire(import.meta.url)('vm') as typeof import('vm');
    const sandbox = Object.create(null) as Record<string, unknown>;
    sandbox['console'] = {
      log: (...args: unknown[]) => { sandbox['__output'] = (sandbox['__output'] as string ?? '') + args.join(' ') + '\n'; },
    };
    sandbox['__output'] = '';

    // timeout belongs on runInNewContext only (not Script constructor options)
    const script = new vm.Script(
      language === 'ts' ? `// TypeScript run as JS (no transpile)\n${code}` : code,
    );
    const result = script.runInNewContext(sandbox, { timeout: CODE_EVAL_TIMEOUT_MS });
    const output = sandbox['__output'] as string || (result !== undefined ? String(result) : '(no output)');

    return { ok: true, output, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ── file_read ─────────────────────────────────────────────────────────────────

async function executeFileRead(ctx: BlockExecutionContext): Promise<BlockResult> {
  const start = Date.now();
  const inputPath = String(ctx.params['path'] ?? '').trim();

  if (!inputPath) {
    return { ok: false, output: null, error: 'No path provided', durationMs: Date.now() - start };
  }

  const resolved = safePath(inputPath);
  if (!resolved) {
    return { ok: false, output: null, error: 'Invalid or unsafe path', durationMs: Date.now() - start };
  }

  try {
    const st = await fs.stat(resolved);
    if (!st.isFile()) {
      return { ok: false, output: null, error: 'Path is not a file', durationMs: Date.now() - start };
    }
    if (st.size > FILE_READ_MAX_BYTES) {
      return {
        ok: false,
        output: null,
        error: `File exceeds max size (${FILE_READ_MAX_BYTES} bytes)`,
        durationMs: Date.now() - start,
      };
    }
    const content = await fs.readFile(resolved, 'utf8');
    return { ok: true, output: content, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ── file_write ────────────────────────────────────────────────────────────────

async function executeFileWrite(ctx: BlockExecutionContext): Promise<BlockResult> {
  const start = Date.now();
  const inputPath = String(ctx.params['path'] ?? '').trim();
  const content = String(ctx.params['content'] ?? '');

  if (!inputPath) {
    return { ok: false, output: false, error: 'No path provided', durationMs: Date.now() - start };
  }
  if (content.length > FILE_WRITE_MAX_CHARS) {
    return {
      ok: false,
      output: false,
      error: `Content exceeds max length (${FILE_WRITE_MAX_CHARS} characters)`,
      durationMs: Date.now() - start,
    };
  }

  // Write restricted to WORKSPACES_DIR only
  const resolved = safePath(inputPath, WORKSPACES_DIR);
  if (!resolved) {
    return { ok: false, output: false, error: 'Write path must be relative and within workspaces directory', durationMs: Date.now() - start };
  }

  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf8');
    return { ok: true, output: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      output: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ── git_diff ──────────────────────────────────────────────────────────────────

async function executeGitDiff(ctx: BlockExecutionContext): Promise<BlockResult> {
  const start = Date.now();
  const rawRepo = ctx.params['repoPath'] != null ? String(ctx.params['repoPath']).trim() : '';
  const repoPath = rawRepo || process.cwd();

  // Validate repo path is not going outside reasonable bounds
  if (path.isAbsolute(repoPath) && !repoPath.startsWith(os.homedir())) {
    return { ok: false, output: null, error: 'Repo path must be within home directory', durationMs: Date.now() - start };
  }

  const { output, exitCode } = await runSpawn('git', ['diff', 'HEAD'], {
    cwd: repoPath,
    signal: ctx.signal,
    timeoutMs: 10_000,
  }).catch((err) => ({ output: String(err), exitCode: -1 }));

  return {
    ok: exitCode === 0,
    output: output || '(no diff)',
    error: exitCode !== 0 ? `git diff failed with code ${exitCode}` : undefined,
    durationMs: Date.now() - start,
  };
}

// ── test_runner ───────────────────────────────────────────────────────────────

async function executeTestRunner(ctx: BlockExecutionContext): Promise<BlockResult> {
  const start = Date.now();
  const command = String(ctx.params['command'] ?? '');
  const rawCwd = ctx.params['cwd'] != null ? String(ctx.params['cwd']).trim() : '';
  const cwd = rawCwd || process.cwd();

  if (!command.trim()) {
    return { ok: false, output: null, error: 'No command provided', durationMs: Date.now() - start };
  }

  // Absolute cwd must stay under home (or be process.cwd for CI checkouts)
  if (
    path.isAbsolute(cwd)
    && path.resolve(cwd) !== path.resolve(process.cwd())
    && !cwd.startsWith(os.homedir())
  ) {
    return {
      ok: false,
      output: null,
      error: 'Working directory must be within home directory',
      durationMs: Date.now() - start,
    };
  }

  const [bin, ...args] = command.trim().split(/\s+/);
  const allowed = ALLOWED_TEST_PREFIXES.some((prefix) => bin === prefix || bin.endsWith(`/${prefix}`));
  if (!allowed) {
    return {
      ok: false,
      output: null,
      error: `Command '${bin}' not in allowed list: ${ALLOWED_TEST_PREFIXES.join(', ')}`,
      durationMs: Date.now() - start,
    };
  }

  const { output, exitCode } = await runSpawn(bin, args, {
    cwd,
    signal: ctx.signal,
    timeoutMs: 120_000, // 2 minutes max
  }).catch((err) => ({ output: String(err), exitCode: -1 }));

  return {
    ok: exitCode === 0,
    output,
    meta: { exitCode: exitCode ?? -1 },
    error: exitCode !== 0 ? `Test runner exited with code ${exitCode}` : undefined,
    durationMs: Date.now() - start,
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

function codingMeta(
  id: string,
  name: string,
  description: string,
  paramDefs: import('@neos-work/shared').WorkflowBlock['paramDefs'],
): import('@neos-work/shared').WorkflowBlock {
  return {
    id,
    name,
    domain: 'coding',
    category: 'coding',
    description,
    isBuiltIn: true,
    implementationType: 'native',
    paramDefs,
    inputDescription: 'Block params and upstream inputs',
    outputDescription: 'Execution result',
  };
}

export function registerCodingBlocks(): void {
  registerNativeBlock(
    { blockId: 'code_eval', execute: executeCodeEval },
    codingMeta('code_eval', 'Code Eval', 'Run JavaScript in a sandboxed vm (5s timeout)', [
      { key: 'code', label: 'Code', type: 'string', description: 'JS source to evaluate' },
      { key: 'language', label: 'Language', type: 'string', default: 'js', options: ['js', 'ts', 'python'] },
    ]),
  );

  registerNativeBlock(
    { blockId: 'file_read', execute: executeFileRead },
    codingMeta('file_read', 'File Read', 'Read a relative file under workspaces', [
      { key: 'path', label: 'Path', type: 'string', description: 'Relative path' },
    ]),
  );

  registerNativeBlock(
    { blockId: 'file_write', execute: executeFileWrite },
    codingMeta('file_write', 'File Write', 'Write a file under workspaces only', [
      { key: 'path', label: 'Path', type: 'string' },
      { key: 'content', label: 'Content', type: 'string' },
    ]),
  );

  registerNativeBlock(
    { blockId: 'git_diff', execute: executeGitDiff },
    codingMeta('git_diff', 'Git Diff', 'Run git diff HEAD in a repository', [
      { key: 'repoPath', label: 'Repo path', type: 'string', description: 'Optional path within home' },
    ]),
  );

  registerNativeBlock(
    { blockId: 'test_runner', execute: executeTestRunner },
    codingMeta('test_runner', 'Test Runner', 'Run allowlisted test commands (npm/pnpm/yarn/pytest/go/cargo)', [
      { key: 'command', label: 'Command', type: 'string', description: 'e.g. pnpm test' },
      { key: 'cwd', label: 'Working directory', type: 'string' },
    ]),
  );
}
