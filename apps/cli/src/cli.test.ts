import { describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
import { EXIT } from './exit-codes.js';

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runCli', () => {
  it('prints help on empty argv with usage exit', async () => {
    const lines: string[] = [];
    const code = await runCli([], {
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.USAGE);
    expect(lines.join('')).toMatch(/Usage/);
  });

  it('version --json', async () => {
    const lines: string[] = [];
    const code = await runCli(['version', '--json'], {
      stdout: (s) => lines.push(s),
    });
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(lines.join(''))).toMatchObject({ name: 'neos', version: '0.6.1' });
  });

  it('status when daemon healthy', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith('/api/health')) {
        return jsonResponse({ status: 'ok', version: '0.5.16', uptime: 12 });
      }
      return jsonResponse({ ok: false, error: 'no' }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['status', '--json'], {
      fetchImpl,
      env: { NEOS_SERVER_URL: 'http://127.0.0.1:3000', NEOS_AUTH_TOKEN: 't' },
      stdout: (s) => lines.push(s),
    });
    expect(code).toBe(EXIT.OK);
    const body = JSON.parse(lines.join(''));
    expect(body.health.status).toBe('ok');
    expect(body.authenticated).toBe(true);
  });

  it('status when daemon down', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error('fetch failed');
    });
    const code = await runCli(['status'], {
      fetchImpl,
      env: { NEOS_SERVER_URL: 'http://127.0.0.1:9' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.DAEMON_DOWN);
  });

  it('project list via API', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/projects') && !url.includes('/files')) {
        return jsonResponse({
          ok: true,
          data: [{ id: 'p1', name: 'Demo', baseDir: '/tmp/d' }],
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['project', 'list'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 'tok', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('p1');
    expect(lines.join('')).toContain('Demo');
  });

  it('files write calls PUT', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return jsonResponse({ ok: true, data: { path: 'index.html' } });
    });
    const code = await runCli(
      ['files', 'write', '--project', 'p1', '--path', 'index.html', '--content', '<h1>x</h1>'],
      {
        fetchImpl,
        env: { NEOS_AUTH_TOKEN: 'tok', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
        stdout: () => {},
        stderr: () => {},
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toContain('/api/projects/p1/files/index.html');
    expect(calls[0]?.body).toContain('<h1>x</h1>');
  });

  it('run create with dry-run', async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (url.endsWith('/api/runs') && init?.method === 'POST') {
        return jsonResponse({ ok: true, data: { id: 'run1', status: 'succeeded' } });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(
      ['run', 'create', '--project', 'p1', '--prompt', 'hello', '--dry-run'],
      {
        fetchImpl,
        env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
        stdout: (s) => lines.push(s),
        stderr: () => {},
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('run1');
  });

  it('unknown command → usage', async () => {
    const code = await runCli(['nope'], { stdout: () => {}, stderr: () => {} });
    expect(code).toBe(EXIT.USAGE);
  });

  it('maps 401 to unauthorized exit', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ ok: false, error: 'Unauthorized' }, 401));
    const code = await runCli(['project', 'list'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 'bad', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.UNAUTHORIZED);
  });
});

describe('runCli expanded commands', () => {
  function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return handler(url, init);
    }) as unknown as typeof fetch;
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('skills list', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/skills')) {
        return jsonResponse({ ok: true, data: [{ id: 's1', name: 'web-landing', enabled: true }] });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['skills', 'list'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('web-landing');
  });

  it('memory add', async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (url.endsWith('/api/memory') && init?.method === 'POST') {
        return jsonResponse({ ok: true, data: { id: 'm1', name: 'note' } }, 201);
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(
      ['memory', 'add', '--name', 'note', '--type', 'user', '--content', 'hello'],
      {
        fetchImpl,
        env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
        stdout: (s) => lines.push(s),
        stderr: () => {},
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('m1');
  });

  it('media generate image', async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (url.includes('/api/media/generate') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          data: { surface: 'image', filename: 'img_x.png', provider: 'stub' },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(
      ['media', 'generate', '--surface', 'image', '--prompt', 'a cat', '--provider', 'stub'],
      {
        fetchImpl,
        env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
        stdout: (s) => lines.push(s),
        stderr: () => {},
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('img_x.png');
  });

  it('plugin atoms', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/plugins/atoms')) {
        return jsonResponse({ ok: true, data: [{ id: 'prompt.system', name: 'System' }] });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['plugin', 'atoms'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('prompt.system');
  });

  it('daemon start uses injectable starter', async () => {
    const lines: string[] = [];
    const code = await runCli(['daemon', 'start'], {
      env: { NEOS_SERVER_URL: 'http://127.0.0.1:3999' },
      fetchImpl: mockFetch(async () => {
        throw new Error('fetch failed');
      }),
      daemon: {
        startDaemon: async () => ({
          port: 3999,
          token: 'new-token',
          pid: 99,
          serverUrl: 'http://127.0.0.1:3999',
        }),
        sessionPath: '/tmp/neos-cli-test-session.json',
      },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('NEOS_AUTH_TOKEN');
    expect(lines.join('')).toContain('new-token');
  });

  it('mcp list', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/mcp-servers')) {
        return jsonResponse({
          ok: true,
          data: [{ id: 'mcp1', name: 'demo', transport: 'stdio', enabled: true }],
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['mcp', 'list'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('demo');
  });

  it('mcp install-info --json via API', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/mcp/install-info')) {
        return jsonResponse({
          ok: true,
          data: {
            serverName: 'neos-work',
            shellSnippet: 'export NEOS_SERVER_URL=http://127.0.0.1:3000\nneos mcp serve',
            codexAddCommand: 'codex mcp add neos-work -- neos mcp serve',
            claudeDesktop: { mcpServers: { 'neos-work': { command: 'neos', args: ['mcp', 'serve'] } } },
          },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['mcp', 'install-info', '--json'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    const body = JSON.parse(lines.join(''));
    expect(body.serverName).toBe('neos-work');
    expect(body.codexAddCommand).toMatch(/codex mcp add/);
  });

  it('mcp install-info falls back locally when API down', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const lines: string[] = [];
    const code = await runCli(['mcp', 'install-info', '--json'], {
      fetchImpl,
      env: {
        NEOS_AUTH_TOKEN: 'tok',
        NEOS_SERVER_URL: 'http://127.0.0.1:9',
        NEOS_PROJECT_ID: 'p1',
      },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    const body = JSON.parse(lines.join(''));
    expect(body.env.NEOS_AUTH_TOKEN).toBe('tok');
    expect(body.env.NEOS_PROJECT_ID).toBe('p1');
    expect(body.args).toEqual(['mcp', 'serve']);
  });

  it('mcp live-artifacts requires project id', async () => {
    const code = await runCli(['mcp', 'live-artifacts'], {
      fetchImpl: mockFetch(() => jsonResponse({ ok: true, data: [] })),
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.USAGE);
  });
});
