import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpExpose, setCodexRunnerForTests } from './mcp-expose.js';

const app = new Hono();
app.route('/api/mcp', mcpExpose);

describe('mcp-expose routes', () => {
  afterEach(() => {
    setCodexRunnerForTests(null);
  });

  it('GET /install-info returns snippets and tools', async () => {
    const res = await app.request('/api/mcp/install-info?projectId=p1&includeToken=0', {
      headers: { Authorization: 'Bearer test-token-xyz' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.serverName).toBe('neos-work');
    expect(body.data.args).toEqual(['mcp', 'serve']);
    expect(body.data.claudeDesktop.mcpServers['neos-work']).toBeTruthy();
    expect(body.data.codexAddCommand).toMatch(/codex mcp add/);
    expect(body.data.tools.some((t: { name: string }) => t.name === 'neos_files_read')).toBe(true);
    // includeToken=0 → no secret in env
    expect(body.data.env.NEOS_AUTH_TOKEN).toBeUndefined();
  });

  it('GET /install-info can echo bearer into env', async () => {
    const res = await app.request('/api/mcp/install-info', {
      headers: { Authorization: 'Bearer tok123' },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.env.NEOS_AUTH_TOKEN).toBe('tok123');
  });

  it('GET /tools lists MCP tools', async () => {
    const res = await app.request('/api/mcp/tools');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(6);
  });

  it('GET /install/codex/status uses runner', async () => {
    setCodexRunnerForTests(async (args) => {
      if (args[0] === '--version') return { stdout: '1', stderr: '', code: 0 };
      return { stdout: '', stderr: 'not found', code: 1 };
    });
    const res = await app.request('/api/mcp/install/codex/status');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.available).toBe(true);
    expect(body.data.installed).toBe(false);
  });

  it('POST /install/codex invokes codex mcp add', async () => {
    const calls: string[][] = [];
    setCodexRunnerForTests(async (args) => {
      calls.push(args);
      return { stdout: 'added', stderr: '', code: 0 };
    });
    const res = await app.request('/api/mcp/install/codex', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ neosBin: '/usr/bin/neos', projectId: 'p1' }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.installed).toBe(true);
    expect(calls[0]?.[0]).toBe('mcp');
    expect(calls[0]?.[1]).toBe('add');
    expect(calls[0]).toContain('/usr/bin/neos');
  });

  it('POST /install/codex surfaces failure', async () => {
    setCodexRunnerForTests(async () => ({
      stdout: '',
      stderr: 'codex missing',
      code: 127,
    }));
    const res = await app.request('/api/mcp/install/codex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('DELETE /install/codex removes', async () => {
    setCodexRunnerForTests(async (args) => {
      expect(args).toEqual(['mcp', 'remove', 'neos-work']);
      return { stdout: 'removed', stderr: '', code: 0 };
    });
    const res = await app.request('/api/mcp/install/codex', { method: 'DELETE' });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.removed).toBe(true);
  });

  it('install-info uses runtime token, env URLs, and drops control-char query', async () => {
    const { setRuntimeContext } = await import('../lib/runtime-context.js');
    const prevPublic = process.env.NEOS_PUBLIC_URL;
    const prevWeb = process.env.NEOS_WEB_URL;
    const prevBin = process.env.NEOS_BIN;
    const prevPort = process.env.PORT;
    try {
      setRuntimeContext({ authToken: 'runtime-tok-abc', port: 3456 });
      process.env.NEOS_PUBLIC_URL = 'https://public.example/';
      process.env.NEOS_WEB_URL = 'https://web.example/';
      process.env.NEOS_BIN = '/opt/neos/bin/neos';
      process.env.PORT = '9999';

      const res = await app.request(
        `/api/mcp/install-info?projectId=${encodeURIComponent('bad\nid')}&neosBin=${encodeURIComponent('x'.repeat(5000))}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { env?: { NEOS_AUTH_TOKEN?: string }; command?: string; args?: string[] };
      };
      expect(body.ok).toBe(true);
      // runtime token preferred over missing Bearer
      expect(body.data.env?.NEOS_AUTH_TOKEN).toBe('runtime-tok-abc');
    } finally {
      setRuntimeContext({ authToken: '', port: 3000 });
      if (prevPublic === undefined) delete process.env.NEOS_PUBLIC_URL;
      else process.env.NEOS_PUBLIC_URL = prevPublic;
      if (prevWeb === undefined) delete process.env.NEOS_WEB_URL;
      else process.env.NEOS_WEB_URL = prevWeb;
      if (prevBin === undefined) delete process.env.NEOS_BIN;
      else process.env.NEOS_BIN = prevBin;
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });

  it('POST install/codex accepts body authToken and DELETE surfaces failure', async () => {
    setCodexRunnerForTests(async (args) => {
      if (args[0] === 'mcp' && args[1] === 'add') {
        return { stdout: 'ok', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: 'remove failed', code: 1 };
    });
    const add = await app.request('/api/mcp/install/codex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authToken: '  body-tok  ',
        projectId: 'proj-1',
        neosBin: '/usr/local/bin/neos',
      }),
    });
    expect(add.status).toBe(200);
    const addBody = (await add.json()) as { ok: boolean };
    expect(addBody.ok).toBe(true);

    const del = await app.request('/api/mcp/install/codex', { method: 'DELETE' });
    expect(del.status).toBe(400);
    const delBody = (await del.json()) as { ok: boolean; error?: string };
    expect(delBody.ok).toBe(false);
    expect(delBody.error).toMatch(/remove failed|codex/i);
  });

  it('codex status/install catch runner throws as 500', async () => {
    setCodexRunnerForTests(async () => {
      throw new Error('runner boom');
    });
    const status = await app.request('/api/mcp/install/codex/status');
    expect(status.status).toBe(500);
    const install = await app.request('/api/mcp/install/codex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(install.status).toBe(500);
    const remove = await app.request('/api/mcp/install/codex', { method: 'DELETE' });
    expect(remove.status).toBe(500);
  });
});
