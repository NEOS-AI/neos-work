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

// Avoid real SQLite/settings I/O during spawn (and keep spawn timing deterministic under load)
vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(() => undefined),
}));

import {
  buildCliArgs,
  buildNeosCliEnv,
  detectCLIs,
  ensureCliWorkspace,
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

describe('spawnCliAgent hygiene', () => {
  it('rejects blank/whitespace prompt', async () => {
    await expect(spawnCliAgent({ cliId: 'cli-claude', prompt: '   ' })).rejects.toThrow(
      /prompt is required/i,
    );
  });

  it('rejects control characters in prompt and cwd', async () => {
    await expect(
      spawnCliAgent({ cliId: 'cli-claude', prompt: 'hi\0there' }),
    ).rejects.toThrow(/control characters/i);
    await expect(
      spawnCliAgent({ cliId: 'cli-claude', prompt: 'ok', cwd: '/tmp\n' }),
    ).rejects.toThrow(/control characters/i);
  });

  it('exports CLI_PROMPT_MAX_CHARS for prompt size bounds', async () => {
    const { CLI_PROMPT_MAX_CHARS } = await import('./cli-agents.js');
    expect(CLI_PROMPT_MAX_CHARS).toBeGreaterThan(100_000);
  });

  it('rejects missing cwd', async () => {
    await expect(
      spawnCliAgent({
        cliId: 'cli-claude',
        prompt: 'ok',
        cwd: path.join(os.tmpdir(), `neos-missing-cwd-${process.pid}`),
      }),
    ).rejects.toThrow(/cwd does not exist/i);
  });
});

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

  it('accepts bin overrides for manual paths', () => {
    expect(buildCliArgs('cli-claude', 'x', '/opt/claude')).toEqual({
      bin: '/opt/claude',
      args: ['--print', 'x'],
    });
    expect(buildCliArgs('cli-gemini', 'x', '/opt/gemini')).toEqual({
      bin: '/opt/gemini',
      args: ['-p', 'x'],
    });
    expect(buildCliArgs('cli-codex', 'x', '/opt/codex')).toEqual({
      bin: '/opt/codex',
      args: ['exec', 'x'],
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

  it('prefers executable path overrides over PATH', async () => {
    const override = path.join(os.tmpdir(), `neos-cli-override-${process.pid}`);
    fs.writeFileSync(override, '#!/bin/sh\necho ok\n', { mode: 0o755 });
    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout?: string, stderr?: string) => void)
        | undefined;
      // which should not be needed for claude when override works
      if (cmd === override && args[0] === '--version') {
        cb?.(null, 'claude override 9.9\n', '');
        return;
      }
      cb?.(new Error('not found'));
    });
    try {
      const found = await detectCLIs({ 'cli-claude': override });
      expect(found.some((a) => a.id === 'cli-claude' && a.path === override)).toBe(true);
      const claude = found.find((a) => a.id === 'cli-claude');
      expect(claude?.version).toMatch(/override/);
    } finally {
      try { fs.unlinkSync(override); } catch { /* ignore */ }
    }
  });

  it('falls back to PATH when override is not executable', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout?: string, stderr?: string) => void)
        | undefined;
      if (cmd === 'which' && args[0] === 'gemini') {
        cb?.(null, '/bin/gemini\n', '');
        return;
      }
      if (cmd === '/bin/gemini' && args[0] === '--version') {
        cb?.(null, 'gemini 0.1\n', '');
        return;
      }
      cb?.(new Error('not found'));
    });
    const found = await detectCLIs({ 'cli-gemini': '/no/such/binary-xyz' });
    expect(found.find((a) => a.id === 'cli-gemini')?.path).toBe('/bin/gemini');
  });

  it('drops null-only which paths and scrubs/caps version stdout', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout?: string, stderr?: string) => void)
        | undefined;
      // which: null-only line → no path (detectCLIs skips agent)
      if (cmd === 'which' && args[0] === 'claude') {
        cb?.(null, `\0\0\n`, '');
        return;
      }
      if (cmd === 'which' && args[0] === 'gemini') {
        cb?.(null, '/bin/gemini\n', '');
        return;
      }
      // Version: scrub nulls; take first line only
      if (cmd === '/bin/gemini' && args[0] === '--version') {
        cb?.(null, `gemini 2.0${'\0'}x\nsecond line\n`, '');
        return;
      }
      if (cmd === 'which' && args[0] === 'codex') {
        cb?.(null, '/bin/codex\n', '');
        return;
      }
      // Overlong version → undefined
      if (cmd === '/bin/codex' && args[0] === '--version') {
        cb?.(null, `${'v'.repeat(250)}\n`, '');
        return;
      }
      cb?.(new Error('not found'));
    });

    const found = await detectCLIs();
    expect(found.find((a) => a.id === 'cli-claude')).toBeUndefined();
    const gemini = found.find((a) => a.id === 'cli-gemini');
    expect(gemini?.path).toBe('/bin/gemini');
    expect(gemini?.version).toBe('gemini 2.0x');
    expect(gemini?.version).not.toContain('\0');
    const codex = found.find((a) => a.id === 'cli-codex');
    expect(codex?.path).toBe('/bin/codex');
    expect(codex?.version).toBeUndefined();
  });

  it('ignores control-char path overrides before PATH fallback', async () => {
    execFileMock.mockImplementation((cmd: string, args: string[], ...rest: unknown[]) => {
      const cb = rest.find((a) => typeof a === 'function') as
        | ((err: Error | null, stdout?: string, stderr?: string) => void)
        | undefined;
      if (cmd === 'which' && args[0] === 'claude') {
        cb?.(null, '/usr/bin/claude\n', '');
        return;
      }
      if (cmd === '/usr/bin/claude' && args[0] === '--version') {
        cb?.(null, 'claude 1.0\n', '');
        return;
      }
      cb?.(new Error('not found'));
    });
    // Leading control override must not be used even if a real path would strip to it
    const found = await detectCLIs({ 'cli-claude': '\n/usr/bin/claude' });
    expect(found.find((a) => a.id === 'cli-claude')?.path).toBe('/usr/bin/claude');
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

  it('skips hidden .json token files', () => {
    const hidden = path.join(tokenDir, `.hidden_${process.pid}.json`);
    try {
      fs.mkdirSync(tokenDir, { recursive: true });
      fs.writeFileSync(
        hidden,
        JSON.stringify({
          serverId: 'hidden-srv',
          accessToken: 'secret',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      const env = loadMcpTokenEnvVars();
      expect(env.NEOS_MCP_TOKEN_HIDDEN_SRV).toBeUndefined();
    } finally {
      try { fs.unlinkSync(hidden); } catch { /* ignore */ }
    }
  });
});

describe('spawnCliAgent', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  /** spawnCliAgent awaits settings import before calling spawn */
  async function waitForSpawn(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (spawnMock.mock.calls.length > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('spawn was not called');
  }

  it('streams stdout and stderr via onChunk and resolves exit code', async () => {
    const child = makeChild();
    spawnMock.mockReturnValue(child);

    const chunks: string[] = [];
    const promise = spawnCliAgent({
      cliId: 'cli-claude',
      prompt: 'hello',
      onChunk: (chunk) => chunks.push(chunk),
    });

    await waitForSpawn();
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

    await waitForSpawn();
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
    await waitForSpawn();
    child.emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('truncates overlong prompts and drops control-char optional fields', async () => {
    const { CLI_PROMPT_MAX_CHARS } = await import('./cli-agents.js');
    const child = makeChild();
    spawnMock.mockReturnValue(child);
    const longPrompt = 'p'.repeat(CLI_PROMPT_MAX_CHARS + 50);
    const promise = spawnCliAgent({
      cliId: 'cli-claude',
      prompt: longPrompt,
      workflowId: 'bad\nid',
      runId: 'r'.repeat(200),
      serverUrl: 'http://x\n',
      authToken: 'tok\0',
    });
    await waitForSpawn();
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    const promptArg = args[args.length - 1] ?? '';
    expect(promptArg.length).toBeLessThan(longPrompt.length);
    expect(promptArg).toMatch(/truncated/i);
    child.emit('exit', 0);
    await promise;
  });

  it('resolves symlink cwd to realpath for spawn', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-cli-cwd-real-'));
    const link = path.join(os.tmpdir(), `neos-cli-cwd-link-${process.pid}`);
    try {
      try {
        fs.symlinkSync(target, link);
      } catch {
        return;
      }
      const child = makeChild();
      spawnMock.mockReturnValue(child);
      const promise = spawnCliAgent({ cliId: 'cli-claude', prompt: 'sym-cwd', cwd: link });
      await waitForSpawn();
      const opts = spawnMock.mock.calls[0]?.[2] as { cwd?: string };
      expect(opts.cwd).toBe(fs.realpathSync(target));
      expect(opts.cwd).not.toBe(link);
      child.emit('exit', 0);
      await promise;
    } finally {
      try { fs.unlinkSync(link); } catch { /* ignore */ }
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('rejects cwd that is a file and uses settings binary override when executable', async () => {
    const fileCwd = path.join(os.tmpdir(), `neos-cli-cwd-file-${process.pid}`);
    fs.writeFileSync(fileCwd, 'not-a-dir');
    try {
      await expect(
        spawnCliAgent({ cliId: 'cli-claude', prompt: 'x', cwd: fileCwd }),
      ).rejects.toThrow(/not a directory/i);
    } finally {
      try { fs.unlinkSync(fileCwd); } catch { /* ignore */ }
    }

    const override = path.join(os.tmpdir(), `neos-cli-bin-${process.pid}`);
    fs.writeFileSync(override, '#!/bin/sh\necho ok\n', { mode: 0o755 });
    const { getSetting } = await import('../db/settings.js');
    vi.mocked(getSetting).mockReturnValueOnce(override);
    const child = makeChild();
    spawnMock.mockReturnValue(child);
    try {
      const promise = spawnCliAgent({ cliId: 'cli-claude', prompt: 'via-override' });
      await waitForSpawn();
      expect(spawnMock.mock.calls[0]?.[0]).toBe(override);
      child.emit('exit', 0);
      await promise;
    } finally {
      vi.mocked(getSetting).mockReturnValue(undefined);
      try { fs.unlinkSync(override); } catch { /* ignore */ }
    }
  });

  it('creates per-run workspace when runId set and cwd omitted', async () => {
    const child = makeChild();
    spawnMock.mockReturnValue(child);
    const runId = `spawn_ws_${process.pid}`;
    const promise = spawnCliAgent({
      cliId: 'cli-gemini',
      prompt: 'workspace cwd',
      runId,
    });
    await waitForSpawn();
    const opts = spawnMock.mock.calls[0]?.[2] as { cwd?: string };
    expect(opts.cwd).toContain(path.join('.config', 'neos-work', 'workspaces'));
    child.emit('exit', 0);
    await promise;
    try {
      fs.rmSync(path.join(os.homedir(), '.config', 'neos-work', 'workspaces', runId), {
        recursive: true,
        force: true,
      });
    } catch { /* ignore */ }
  });
});


describe('buildNeosCliEnv / ensureCliWorkspace', () => {
  it('maps NEOS_* env vars', () => {
    expect(buildNeosCliEnv({
      serverUrl: 'http://127.0.0.1:3000',
      authToken: 'tok',
      workflowId: 'wf-1',
      runId: 'run-1',
      collabSessionId: 'collab-sess-1',
    })).toEqual({
      NEOS_SERVER_URL: 'http://127.0.0.1:3000',
      NEOS_AUTH_TOKEN: 'tok',
      NEOS_WORKFLOW_ID: 'wf-1',
      NEOS_RUN_ID: 'run-1',
      NEOS_COLLAB_SESSION_ID: 'collab-sess-1',
    });
  });

  it('omits empty fields', () => {
    expect(buildNeosCliEnv({})).toEqual({});
  });

  it('trims env values and drops whitespace-only fields', () => {
    expect(
      buildNeosCliEnv({
        serverUrl: '  http://127.0.0.1:9  ',
        authToken: '  tok  ',
        workflowId: '  wf  ',
        runId: '  run  ',
      }),
    ).toEqual({
      NEOS_SERVER_URL: 'http://127.0.0.1:9',
      NEOS_AUTH_TOKEN: 'tok',
      NEOS_WORKFLOW_ID: 'wf',
      NEOS_RUN_ID: 'run',
    });
    expect(
      buildNeosCliEnv({
        serverUrl: '   ',
        authToken: '   ',
        workflowId: '   ',
        runId: '   ',
      }),
    ).toEqual({});
  });

  it('only injects http(s) NEOS_SERVER_URL (strips trailing slash)', () => {
    expect(buildNeosCliEnv({ serverUrl: 'https://api.example/v1/' })).toEqual({
      NEOS_SERVER_URL: 'https://api.example/v1',
    });
    expect(buildNeosCliEnv({ serverUrl: 'file:///etc/passwd' })).toEqual({});
    expect(buildNeosCliEnv({ serverUrl: 'javascript:alert(1)' })).toEqual({});
    expect(buildNeosCliEnv({ serverUrl: 'not-a-url', authToken: 't' })).toEqual({
      NEOS_AUTH_TOKEN: 't',
    });
  });

  it('creates workspace under ~/.config/neos-work/workspaces', () => {
    const runId = `_cov_ws_${process.pid}`;
    const dir = ensureCliWorkspace(runId);
    expect(dir).toContain(path.join('.config', 'neos-work', 'workspaces', runId));
    expect(fs.existsSync(dir)).toBe(true);
    // realpath form
    expect(dir).toBe(fs.realpathSync(dir));
    // cleanup
    try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
  });

  it('refuses workspace path that is a symlink escape', () => {
    const runId = `_cov_ws_link_${process.pid}`;
    const workspacesRoot = path.join(os.homedir(), '.config', 'neos-work', 'workspaces');
    const linkPath = path.join(workspacesRoot, runId);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-ws-out-'));
    try {
      fs.mkdirSync(workspacesRoot, { recursive: true });
      try {
        fs.symlinkSync(outside, linkPath);
      } catch {
        return;
      }
      expect(() => ensureCliWorkspace(runId)).toThrow(/Invalid runId/i);
    } finally {
      try { fs.unlinkSync(linkPath); } catch { /* ignore */ }
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('sanitizes runId and rejects blank / traversal-like ids', () => {
    expect(() => ensureCliWorkspace('   ')).toThrow(/Invalid runId/i);
    expect(() => ensureCliWorkspace('')).toThrow(/Invalid runId/i);
    expect(() => ensureCliWorkspace('bad\nid')).toThrow(/Invalid runId/i);
    expect(() => ensureCliWorkspace('x'.repeat(101))).toThrow(/Invalid runId/i);
    expect(() => ensureCliWorkspace(null as unknown as string)).toThrow(/Invalid runId/i);
    // punctuation becomes underscores and is accepted
    const punct = ensureCliWorkspace(`!!!_${process.pid}`);
    expect(path.basename(punct)).toMatch(/_+/);
    try { fs.rmSync(punct, { recursive: true }); } catch { /* ignore */ }

    const dirty = `../evil_${process.pid}`;
    const dir = ensureCliWorkspace(dirty);
    const workspacesRoot = path.join(os.homedir(), '.config', 'neos-work', 'workspaces');
    const rootReal = fs.realpathSync(workspacesRoot);
    expect(dir.startsWith(rootReal + path.sep) || dir === rootReal).toBe(true);
    expect(path.basename(dir)).toBe(`___evil_${process.pid}`);
    try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }

    const padded = ensureCliWorkspace(`  run_${process.pid}  `);
    expect(path.basename(padded)).toBe(`run_${process.pid}`);
    try { fs.rmSync(padded, { recursive: true }); } catch { /* ignore */ }
  });

  it('drops control-char / overlong env fields', () => {
    expect(
      buildNeosCliEnv({
        serverUrl: 'http://127.0.0.1:1\n',
        authToken: 'tok\nid',
        workflowId: 'wf\nid',
        runId: 'r'.repeat(101),
      }),
    ).toEqual({});
  });
});

describe('loadMcpTokenEnvVars hygiene', () => {
  const tokenDir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
  const files: string[] = [];

  afterEach(() => {
    for (const f of files.splice(0)) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('skips control-char serverId/accessToken and malformed JSON', () => {
    fs.mkdirSync(tokenDir, { recursive: true });
    const badCtrl = path.join(tokenDir, `_cov_ctrl_${process.pid}.json`);
    const badJson = path.join(tokenDir, `_cov_badjson_${process.pid}.json`);
    const emptyTok = path.join(tokenDir, `_cov_empty_${process.pid}.json`);
    files.push(badCtrl, badJson, emptyTok);

    fs.writeFileSync(
      badCtrl,
      JSON.stringify({
        serverId: 'bad\nid',
        accessToken: 'tok',
      }),
    );
    fs.writeFileSync(badJson, '{not-json');
    fs.writeFileSync(
      emptyTok,
      JSON.stringify({
        serverId: '  ',
        accessToken: 'tok',
      }),
    );

    const env = loadMcpTokenEnvVars();
    expect(env.NEOS_MCP_TOKEN_BAD_ID).toBeUndefined();
    // blank serverId skipped
    expect(Object.values(env).includes('tok')).toBe(false);
  });

  it('skips overlong access tokens', () => {
    fs.mkdirSync(tokenDir, { recursive: true });
    const f = path.join(tokenDir, `_cov_longtok_${process.pid}.json`);
    files.push(f);
    fs.writeFileSync(
      f,
      JSON.stringify({
        serverId: 'long-srv',
        accessToken: 't'.repeat(20_000),
      }),
    );
    const env = loadMcpTokenEnvVars();
    expect(env.NEOS_MCP_TOKEN_LONG_SRV).toBeUndefined();
  });

  it('skips symlink token files (no outside content injection)', () => {
    fs.mkdirSync(tokenDir, { recursive: true });
    const outside = path.join(os.tmpdir(), `_cov_mcp_out_${process.pid}.json`);
    const link = path.join(tokenDir, `_cov_mcp_link_${process.pid}.json`);
    files.push(outside, link);
    fs.writeFileSync(
      outside,
      JSON.stringify({
        serverId: 'symlink-srv',
        accessToken: 'leaked-token-from-outside',
      }),
    );
    try {
      fs.symlinkSync(outside, link);
    } catch {
      return;
    }
    const env = loadMcpTokenEnvVars();
    expect(env.NEOS_MCP_TOKEN_SYMLINK_SRV).toBeUndefined();
    expect(Object.values(env).includes('leaked-token-from-outside')).toBe(false);
  });
});
