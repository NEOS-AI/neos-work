import { describe, expect, it, vi } from 'vitest';
import {
  CODEX_MCP_NAME,
  getCodexMcpStatus,
  installCodexMcp,
  uninstallCodexMcp,
  type CodexMcpRunner,
} from './codex-mcp.js';

describe('codex-mcp', () => {
  it('reports unavailable when codex missing', async () => {
    const runner: CodexMcpRunner = vi.fn(async () => ({
      stdout: '',
      stderr: 'not found',
      code: 127,
    }));
    const st = await getCodexMcpStatus(runner);
    expect(st.available).toBe(false);
    expect(st.installed).toBe(false);
  });

  it('detects installed server', async () => {
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      if (args[0] === '--version') return { stdout: 'codex 1.0', stderr: '', code: 0 };
      if (args[0] === 'mcp' && args[1] === 'get') {
        return { stdout: `${CODEX_MCP_NAME}: /usr/bin/neos mcp serve`, stderr: '', code: 0 };
      }
      return { stdout: '', stderr: 'no', code: 1 };
    });
    const st = await getCodexMcpStatus(runner);
    expect(st.available).toBe(true);
    expect(st.installed).toBe(true);
  });

  it('install builds codex mcp add argv', async () => {
    const calls: string[][] = [];
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      calls.push(args);
      return { stdout: 'ok', stderr: '', code: 0 };
    });
    const res = await installCodexMcp(
      {
        command: '/usr/bin/neos',
        args: ['mcp', 'serve'],
        env: { NEOS_SERVER_URL: 'http://127.0.0.1:3000', NEOS_AUTH_TOKEN: 'secret-token-value' },
      },
      runner,
    );
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual([
      'mcp',
      'add',
      CODEX_MCP_NAME,
      '--env',
      'NEOS_SERVER_URL=http://127.0.0.1:3000',
      '--env',
      'NEOS_AUTH_TOKEN=secret-token-value',
      '--',
      '/usr/bin/neos',
      'mcp',
      'serve',
    ]);
    // API-facing command line must not leak the token
    expect(res.command).toContain('NEOS_AUTH_TOKEN=***');
    expect(res.command).not.toContain('secret-token-value');
  });

  it('rejects bad command on install', async () => {
    const res = await installCodexMcp(
      { command: 'x\ny', args: [], env: {} },
      vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    );
    expect(res.ok).toBe(false);
  });

  it('uninstall calls remove', async () => {
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      expect(args).toEqual(['mcp', 'remove', CODEX_MCP_NAME]);
      return { stdout: 'removed', stderr: '', code: 0 };
    });
    const res = await uninstallCodexMcp(runner);
    expect(res.ok).toBe(true);
  });
});

describe('codex-mcp additional branches', () => {
  it('status unavailable when version fails with empty output', async () => {
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      if (args[0] === '--version') return { stdout: '', stderr: '', code: 1 };
      return { stdout: '', stderr: '', code: 1 };
    });
    const st = await getCodexMcpStatus(runner);
    expect(st.available).toBe(false);
    expect(st.detail).toMatch(/not available/i);
  });

  it('status not installed when mcp get fails', async () => {
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      if (args[0] === '--version') return { stdout: '1', stderr: '', code: 0 };
      return { stdout: '', stderr: 'not found', code: 1 };
    });
    const st = await getCodexMcpStatus(runner);
    expect(st.available).toBe(true);
    expect(st.installed).toBe(false);
    expect(st.detail).toMatch(/not found|not installed/i);
  });

  it('install skips bad env keys/values and filters args', async () => {
    const calls: string[][] = [];
    const runner: CodexMcpRunner = vi.fn(async (args) => {
      calls.push(args);
      return { stdout: '', stderr: '', code: 0 };
    });
    const res = await installCodexMcp(
      {
        command: '/bin/neos',
        args: ['ok', '', 'bad\narg', 'x'.repeat(600), 'keep'],
        env: {
          GOOD: 'yes',
          'bad-key': 'no',
          BADNL: 'a\nb',
          EMPTY: '',
        },
      },
      runner,
    );
    expect(res.ok).toBe(true);
    expect(calls[0]).toContain('--env');
    expect(calls[0]).toContain('GOOD=yes');
    expect(calls[0]?.join(' ')).not.toMatch(/bad-key|BADNL|bad\\narg/);
    expect(calls[0]).toContain('ok');
    expect(calls[0]).toContain('keep');
  });

  it('install rejects empty command', async () => {
    const res = await installCodexMcp(
      { command: '   ', args: [], env: {} },
      vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    );
    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/Invalid command/i);
  });

  it('uninstall reports failure when runner non-zero', async () => {
    const res = await uninstallCodexMcp(
      vi.fn(async () => ({ stdout: '', stderr: 'nope', code: 1 })),
    );
    expect(res.ok).toBe(false);
    expect(res.stderr).toBe('nope');
  });
});
