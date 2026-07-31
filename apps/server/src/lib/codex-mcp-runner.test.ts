import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileAsyncMock = vi.fn();

vi.mock('node:child_process', () => {
  const execFile = Object.assign(
    vi.fn(),
    {
      [Symbol.for('nodejs.util.promisify.custom')]: (
        file: string,
        args: string[],
        opts?: unknown,
      ) => execFileAsyncMock(file, args, opts),
    },
  );
  return { execFile };
});

import { defaultCodexRunner } from './codex-mcp.js';

afterEach(() => {
  execFileAsyncMock.mockReset();
});

describe('defaultCodexRunner', () => {
  it('returns stdout/stderr on success and scrubs null bytes', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'out\0x', stderr: 'err' });
    const r = await defaultCodexRunner(['--version'], { timeoutMs: 1000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('outx');
    expect(r.stderr).toBe('err');
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'codex',
      ['--version'],
      expect.objectContaining({ timeout: 1000, maxBuffer: 256 * 1024 }),
    );
  });

  it('maps ENOENT to code 127', async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
    );
    const r = await defaultCodexRunner(['--version']);
    expect(r.code).toBe(127);
    expect(r.stderr).toMatch(/ENOENT|codex/i);
  });

  it('maps numeric exit codes and killed timeout', async () => {
    execFileAsyncMock.mockRejectedValueOnce(
      Object.assign(new Error('fail'), { code: 2, stdout: 'a', stderr: 'b' }),
    );
    const r1 = await defaultCodexRunner(['x']);
    expect(r1.code).toBe(2);
    expect(r1.stdout).toBe('a');
    expect(r1.stderr).toBe('b');

    execFileAsyncMock.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { killed: true, message: 'killed' }),
    );
    const r2 = await defaultCodexRunner(['x']);
    expect(r2.code).toBe(124);
  });
});
