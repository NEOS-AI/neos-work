/**
 * Path override loading from settings (separate file so getSetting can return paths).
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const getSettingMock = vi.fn((_key: string): string | null => null);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

vi.mock('../db/settings.js', () => ({
  getSetting: (key: string) => getSettingMock(key),
}));

const { spawnRegistryAgent, loadAllPathOverrides } = await import('./registry-spawn.js');
const { getDefById } = await import('@neos-work/agent-runtime');

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

describe('registry-spawn path overrides', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    getSettingMock.mockReset();
    getSettingMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loadAllPathOverrides maps setting keys to agent ids', () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'CLI_PATH_CLAUDE') return '  /opt/claude  ';
      if (key === 'CLI_PATH_AIDER') return 'aider-bin';
      if (key === 'CLI_PATH_GEMINI') return 'bad\npath';
      if (key === 'CLI_PATH_CODEX') return '   ';
      return null;
    });
    const overrides = loadAllPathOverrides();
    expect(overrides['cli-claude']).toBe('/opt/claude');
    expect(overrides['cli-aider']).toBe('aider-bin');
    // control-char and blank dropped
    expect(overrides['cli-gemini']).toBeUndefined();
    expect(overrides['cli-codex']).toBeUndefined();
  });

  it('spawn uses executable override as bin when access allows', async () => {
    const execPath = process.execPath; // should be X_OK
    const claudeDef = getDefById('cli-claude');
    expect(claudeDef).toBeTruthy();
    getSettingMock.mockImplementation((key: string) => {
      if (key === claudeDef!.settingKey) return execPath;
      return null;
    });

    // verify execPath is accessible as executable
    expect(() => fs.accessSync(execPath, fs.constants.X_OK)).not.toThrow();

    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = spawnRegistryAgent({
      agentId: 'cli-claude',
      prompt: 'use override bin',
    });
    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('ok'));
    child.emit('close', 0);
    await promise;

    expect(spawnMock).toHaveBeenCalled();
    const [bin] = spawnMock.mock.calls[0]!;
    expect(bin).toBe(execPath);
  });

  it('spawn ignores non-executable override path', async () => {
    getSettingMock.mockImplementation((key: string) => {
      if (key === 'CLI_PATH_AIDER') return '/definitely/not/an/executable-neos-cov';
      return null;
    });

    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'fallback bin',
    });
    await Promise.resolve();
    child.emit('close', 0);
    await promise;

    const [bin] = spawnMock.mock.calls[0]!;
    // falls back to catalog binary name
    expect(bin).toBe('aider');
  });

  it('skips control-char and blank overrides for single agent', async () => {
    getSettingMock.mockReturnValue('path\nwith\nnewline');
    const child = mockChild();
    spawnMock.mockReturnValue(child);
    const promise = spawnRegistryAgent({
      agentId: 'cli-aider',
      prompt: 'ctrl override',
    });
    await Promise.resolve();
    child.emit('close', 0);
    await promise;
    expect(spawnMock.mock.calls[0]![0]).toBe('aider');
  });
});
