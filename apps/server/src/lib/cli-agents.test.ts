import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, execFileMock, execFileImpl } = vi.hoisted(() => {
  const spawnMock = vi.fn();
  const execFileMock = vi.fn();
  function execFileImpl(...args: unknown[]) {
    return execFileMock(...args);
  }
  (execFileImpl as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (
    cmd: string,
    args: string[],
    opts?: unknown,
  ) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileMock(cmd, args, opts, (err: Error | null, stdout?: string, stderr?: string) => {
        if (err) reject(err);
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  return { spawnMock, execFileMock, execFileImpl };
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: execFileImpl,
}));

import {
  buildCliArgs,
  detectCLIs,
  loadMcpTokenEnvVars,
  spawnCliAgent,
} from './cli-agents.js';

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('buildCliArgs', () => {
  it('maps each CLI to its non-interactive flags', () => {
    expect(buildCliArgs('cli-claude', 'hi')).toEqual({
      bin: 'claude',
      args: ['--print', 'hi'],
    });
    expect(buildCliArgs('cli-gemini', 'hi')).toEqual({
      bin: 'gemini',
      args: ['-p', 'hi'],
    });
    expect(buildCliArgs('cli-codex', 'hi')).toEqual({
      bin: 'codex',
      args: ['exec', 'hi'],
    });
  });
});

describe('detectCLIs', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('returns empty list when no CLIs are on PATH', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
      const callback = typeof _opts === 'function' ? (_opts as (err: Error) => void) : cb;
      callback(new Error('not found'));
    });
    const found = await detectCLIs();
    expect(found).toEqual([]);
  });

  it('detects claude when which succeeds', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout?: string, stderr?: string) => void)
        | undefined;
      if (cmd === 'which' && args[0] === 'claude') {
        cb?.(null, '/usr/local/bin/claude\n', '');
        return;
      }
      if (cmd === '/usr/local/bin/claude' && args[0] === '--version') {
        cb?.(null, 'claude 1.2.3\n', '');
        return;
      }
      cb?.(new Error('not found'));
    });
    const found = await detectCLIs();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'cli-claude',
      name: 'Claude Code',
      path: '/usr/local/bin/claude',
      version: 'claude 1.2.3',
    });
  });
});

describe('loadMcpTokenEnvVars', () => {
  const tokenDir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
  const testFile = path.join(tokenDir, `_cov_cli_${process.pid}.json`);

  afterEach(() => {
    try { fs.unlinkSync(testFile); } catch { /* ignore */ }
  });

  it('loads non-expired tokens as env vars', () => {
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(
      testFile,
      JSON.stringify({
        serverId: 'my-server',
        accessToken: 'tok-abc',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const env = loadMcpTokenEnvVars();
    expect(env.NEOS_MCP_TOKEN_MY_SERVER).toBe('tok-abc');
  });

  it('skips expired tokens', () => {
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(
      testFile,
      JSON.stringify({
        serverId: 'expired-srv',
        accessToken: 'old',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const env = loadMcpTokenEnvVars();
    expect(env.NEOS_MCP_TOKEN_EXPIRED_SRV).toBeUndefined();
  });
});

describe('spawnCliAgent', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('streams stdout and stderr via onChunk and resolves exit code', async () => {
    const child = makeChild();
    spawnMock.mockReturnValue(child);

    const chunks: string[] = [];
    const promise = spawnCliAgent({
      cliId: 'cli-claude',
      prompt: 'hello',
      onChunk: (chunk) => chunks.push(chunk),
    });

    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('out-'));
    child.stderr.emit('data', Buffer.from('err'));
    child.emit('exit', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('out-err');
    expect(chunks.join('')).toBe('out-err');
    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      ['--print', 'hello'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('SIGTERMs child when AbortSignal fires', async () => {
    const child = makeChild();
    spawnMock.mockReturnValue(child);
    const ac = new AbortController();

    const promise = spawnCliAgent({
      cliId: 'cli-gemini',
      prompt: 'x',
      signal: ac.signal,
    });

    await Promise.resolve();
    ac.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null);

    const result = await promise;
    expect(result.exitCode).toBeNull();
  });

  it('rejects when spawn emits error', async () => {
    const child = makeChild();
    spawnMock.mockReturnValue(child);
    const promise = spawnCliAgent({ cliId: 'cli-codex', prompt: 'x' });
    await Promise.resolve();
    child.emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('ENOENT');
  });
});
