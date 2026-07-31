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
        env: { NEOS_SERVER_URL: 'http://127.0.0.1:3000', NEOS_AUTH_TOKEN: 't' },
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
      'NEOS_AUTH_TOKEN=t',
      '--',
      '/usr/bin/neos',
      'mcp',
      'serve',
    ]);
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
