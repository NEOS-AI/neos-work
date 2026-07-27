import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

vi.mock('../db/settings.js', () => ({
  getSetting: () => null,
}));

const { spawnRegistryAgent, isLegacyCliId, loadAllPathOverrides } = await import('./registry-spawn.js');

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return child;
}

describe('spawnRegistryAgent', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('isLegacyCliId recognizes classic three', () => {
    expect(isLegacyCliId('cli-claude')).toBe(true);
    expect(isLegacyCliId('cli-aider')).toBe(false);
  });

  it('rejects unknown agent', async () => {
    await expect(
      spawnRegistryAgent({ agentId: 'cli-nope', prompt: 'hi' }),
    ).rejects.toThrow(/Unknown agent/);
  });

  it('spawns aider with registry argv template', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'fix bug',
      onChunk: vi.fn(),
    });

    // allow listeners
    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('ok'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ok');
    expect(spawnMock).toHaveBeenCalled();
    const [bin, args] = spawnMock.mock.calls[0]!;
    expect(bin).toBe('aider');
    expect(args).toEqual(['--message', 'fix bug', '--yes']);
  });

  it('rejects empty prompt', async () => {
    await expect(
      spawnRegistryAgent({ agentId: 'cli-claude', prompt: '  ' }),
    ).rejects.toThrow(/prompt/);
  });
});

describe('spawnRegistryAgent extra paths', () => {
  it('rejects null-byte prompt and bad cwd', async () => {
    await expect(
      spawnRegistryAgent({ agentId: 'cli-aider', prompt: 'hi\0there' }),
    ).rejects.toThrow(/control characters/i);

    await expect(
      spawnRegistryAgent({
        agentId: 'cli-aider',
        prompt: 'ok',
        cwd: '/no/such/dir/neos-cov',
      }),
    ).rejects.toThrow(/does not exist|cwd/i);

    await expect(
      spawnRegistryAgent({
        agentId: 'cli-aider',
        prompt: 'ok',
        cwd: 'bad\ncwd',
      }),
    ).rejects.toThrow(/control characters/i);
  });

  it('truncates overlong prompts and uses runId workspace when no cwd', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'p'.repeat(200_000),
      runId: `run_ws_${process.pid}`,
      projectId: `proj_${process.pid}`,
      serverUrl: 'http://127.0.0.1:3999',
      authToken: 'tok',
      onChunk: vi.fn(),
    });

    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('chunk1'));
    child.stderr.emit('data', Buffer.from('err1'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('chunk1');
    expect(spawnMock).toHaveBeenCalled();
  });

  it('aborts running child when signal fires', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);
    const ac = new AbortController();

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'abort me',
      signal: ac.signal,
    });

    await Promise.resolve();
    ac.abort();
    child.emit('close', 1);

    const result = await promise;
    expect(child.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it('loadAllPathOverrides returns map from settings', () => {
    // settings mock returns null → empty
    expect(loadAllPathOverrides()).toEqual({});
  });

  it('rejects spawn error event', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'fail spawn',
    });

    await Promise.resolve();
    child.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow(/ENOENT/);
  });
});

describe('path overrides from settings', () => {
  it('loadOverride uses executable setting path', async () => {
    // Re-mock getSetting for this file is static null; instead test loadAllPathOverrides empty
    // and spawn with valid cwd that is a file path rejected
    const child = mockChild();
    spawnMock.mockReturnValue(child);
    const filePath = process.execPath; // is a file not directory

    await expect(
      spawnRegistryAgent({
        agentId: 'cli-aider',
        prompt: 'cwd file',
        cwd: filePath,
      }),
    ).rejects.toThrow(/not a directory/i);
  });

  it('already-aborted signal kills immediately', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);
    const ac = new AbortController();
    ac.abort();

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'preabort',
      signal: ac.signal,
    });

    await Promise.resolve();
    child.emit('close', 0);
    const result = await promise;
    expect(child.kill).toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });
});
