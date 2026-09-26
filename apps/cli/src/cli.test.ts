import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli.js';
import { CLI_VERSION } from './commands/version.js';
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
    // Must track @neos-work/shared NEOS_VERSION (not a frozen train pin)
    expect(JSON.parse(lines.join(''))).toMatchObject({ name: 'neos', version: CLI_VERSION });
    expect(typeof CLI_VERSION).toBe('string');
    expect(CLI_VERSION.length).toBeGreaterThan(0);
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

  it('skills find maps to catalog search', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, method: init?.method });
      if (url.includes('/api/skills/catalog/search')) {
        return jsonResponse({
          ok: true,
          data: {
            query: 'find',
            searchType: 'fuzzy',
            count: 1,
            skills: [
              {
                id: 'vercel-labs/skills/find-skills',
                name: 'find-skills',
                source: 'vercel-labs/skills',
                installs: 12,
                installed: false,
              },
            ],
          },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['skills', 'find', 'find', '--owner', 'vercel-labs'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toContain('/api/skills/catalog/search');
    expect(calls[0]?.url).toContain('q=find');
    expect(calls[0]?.url).toContain('owner=vercel-labs');
    expect(lines.join('')).toContain('find-skills');
    expect(lines.join('')).not.toMatch(/\bnpx\b/);
  });

  it('skills add without --yes exits 2', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, data: {} })) as unknown as typeof fetch;
    const err: string[] = [];
    const code = await runCli(['skills', 'add', 'vercel-labs/skills'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: (s) => err.push(s),
    });
    expect(code).toBe(EXIT.USAGE);
    expect(err.join('')).toContain('pass --yes to confirm');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skills add with --yes posts confirm:true', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return jsonResponse({
        ok: true,
        data: { id: 's1', name: 'find-skills', source: 'remote' },
      });
    });
    const code = await runCli(
      ['skills', 'add', 'vercel-labs/skills', '--skill', 'find-skills', '--scope', 'global', '--yes'],
      {
        fetchImpl,
        env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
        stdout: () => {},
        stderr: () => {},
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/api/skills/install');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      source: 'vercel-labs/skills',
      slug: 'find-skills',
      scope: 'global',
      confirm: true,
    });
  });

  it('skills add skill_ambiguous exits 14 and prints candidates', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        {
          ok: false,
          error: 'skill_ambiguous',
          candidates: [
            { slug: 'alpha', name: 'Alpha' },
            { slug: 'beta', name: 'Beta' },
          ],
        },
        400,
      ),
    );
    const err: string[] = [];
    const code = await runCli(['skills', 'add', 'vercel-labs/skills', '--yes'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: (s) => err.push(s),
    });
    expect(code).toBe(EXIT.VALIDATION);
    expect(err.join('')).toContain('--skill');
    expect(err.join('')).toContain('alpha');
    expect(err.join('')).toContain('beta');
  });

  it('skills update with no args updates all remotes', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith('/api/skills') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({
          ok: true,
          data: [
            { id: 'r1', name: 'find-skills', source: 'remote' },
            { id: 'r2', name: 'other', source: 'remote' },
            { id: 'b1', name: 'bundled', source: 'bundled' },
          ],
        });
      }
      if (url.includes('/update')) {
        const id = url.split('/').at(-2);
        return jsonResponse({ ok: true, data: { id, unchanged: false } });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['skills', 'update', '--yes'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    const updateUrls = calls.filter((c) => c.method === 'POST' && c.url.includes('/update')).map((c) => c.url);
    expect(updateUrls).toHaveLength(2);
    expect(updateUrls.some((u) => u.includes('/api/skills/r1/update'))).toBe(true);
    expect(updateUrls.some((u) => u.includes('/api/skills/r2/update'))).toBe(true);
    expect(updateUrls.some((u) => u.includes('/api/skills/b1/update'))).toBe(false);
    expect(lines.join('')).toContain('r1');
    expect(lines.join('')).toContain('r2');
  });

  it('skills update with no remotes exits 0', async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (url.endsWith('/api/skills') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ ok: true, data: [{ id: 'b1', name: 'bundled', source: 'bundled' }] });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['skills', 'update', '--yes'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('0 remotes updated');
  });

  it('skills remove without --yes exits 2', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, data: {} })) as unknown as typeof fetch;
    const err: string[] = [];
    const code = await runCli(['skills', 'remove', 'find-skills'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: (s) => err.push(s),
    });
    expect(code).toBe(EXIT.USAGE);
    expect(err.join('')).toContain('pass --yes to confirm');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skills commands do not spawn npx', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      readFileSync(join(here, 'commands/skills.ts'), 'utf8'),
      readFileSync(join(here, 'client.ts'), 'utf8'),
    ];
    for (const src of files) {
      expect(src).not.toMatch(/\bnpx\b/);
      expect(src).not.toMatch(/child_process/);
      expect(src).not.toMatch(/\bspawn\s*\(/);
    }
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/skills/catalog/search')) {
        return jsonResponse({ ok: true, data: { query: 'x', skills: [], count: 0 } });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const code = await runCli(['skills', 'find', 'xx'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
  });

  it('cli-agents list and catalog', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/cli-agents/catalog')) {
        return jsonResponse({
          ok: true,
          data: [{ id: 'cli-claude', name: 'Claude', family: 'anthropic', binary: 'claude' }],
        });
      }
      if (url.includes('/api/cli-agents')) {
        return jsonResponse({
          ok: true,
          data: [{ id: 'cli-claude', name: 'Claude', available: true, path: '/usr/bin/claude' }],
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const listCode = await runCli(['cli-agents', 'list'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(listCode).toBe(EXIT.OK);
    expect(lines.join('')).toContain('cli-claude');

    const catLines: string[] = [];
    const catCode = await runCli(['cli-agents', 'catalog', '--json'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => catLines.push(s),
      stderr: () => {},
    });
    expect(catCode).toBe(EXIT.OK);
    expect(JSON.parse(catLines.join(''))[0]).toMatchObject({ id: 'cli-claude' });
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

  it('memory export prints markdown', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/api/memory/export')) {
        return new Response('# Memories\n\n- note\n', {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['memory', 'export'], {
      fetchImpl,
      env: { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' },
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('\n')).toContain('# Memories');
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

describe('design-systems content/rules/tokens', () => {
  const env = { NEOS_AUTH_TOKEN: 't', NEOS_SERVER_URL: 'http://127.0.0.1:3000' };
  const tmpFiles: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpFiles.splice(0).map((p) => rm(p, { force: true })));
  });

  function recordFetch(handler?: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (handler) return handler(url, init);
      return jsonResponse({ ok: true, data: {} });
    });
    return { fetchImpl, calls };
  }

  it('design-systems list still prints id/name/source', async () => {
    const { fetchImpl } = recordFetch((url) => {
      if (url.endsWith('/api/design-systems')) {
        return jsonResponse({
          ok: true,
          data: [{ id: 'ds1', name: 'Mine', source: 'user' }],
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['design-systems', 'list'], {
      fetchImpl,
      env,
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('ds1');
    expect(lines.join('')).toContain('Mine');
  });

  it('design-systems rules <id> prints RULES.md on stdout', async () => {
    const { fetchImpl, calls } = recordFetch((url) => {
      if (url.includes('/rules')) {
        return jsonResponse({
          ok: true,
          data: { content: '# Agent rules\n- never hex\n' },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['design-systems', 'rules', 'ds1'], {
      fetchImpl,
      env,
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('# Agent rules');
    expect(lines.join('')).toContain('never hex');
    expect(calls[0]?.url).toContain('/rules');
    expect(calls[0]?.method === undefined || calls[0]?.method === 'GET').toBe(true);
  });

  it('design-systems content <id> prints DESIGN.md', async () => {
    const { fetchImpl } = recordFetch((url) => {
      if (url.includes('/content')) {
        return jsonResponse({ ok: true, data: { content: '# Design\n' } });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['design-systems', 'content', 'ds1'], {
      fetchImpl,
      env,
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('# Design');
  });

  it('design-systems tokens <id> prints tokens.css', async () => {
    const { fetchImpl } = recordFetch((url) => {
      if (url.includes('/tokens')) {
        return jsonResponse({
          ok: true,
          data: { content: ':root { --color-primary: #3B82F6; }' },
        });
      }
      return jsonResponse({ ok: false }, 404);
    });
    const lines: string[] = [];
    const code = await runCli(['design-systems', 'tokens', 'ds1'], {
      fetchImpl,
      env,
      stdout: (s) => lines.push(s),
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toContain('--color-primary');
  });

  it('rules <id> --file <path> PUTs file contents', async () => {
    const tmpRules = join(tmpdir(), `neos-cli-ds-rules-${process.pid}-${Date.now()}.md`);
    tmpFiles.push(tmpRules);
    const body = '# Agent rules\n\n## Never\n- x\n';
    await writeFile(tmpRules, body, 'utf8');
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ ok: true }));
    const code = await runCli(['design-systems', 'rules', 'ds1', '--file', tmpRules], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.OK);
    const put = calls.at(-1);
    expect(put?.method).toBe('PUT');
    expect(put?.url).toContain('/rules');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ content: body });
  });

  it('content <id> --file and tokens <id> --file PUT the matching routes', async () => {
    const tmpContent = join(tmpdir(), `neos-cli-ds-content-${process.pid}-${Date.now()}.md`);
    const tmpTokens = join(tmpdir(), `neos-cli-ds-tokens-${process.pid}-${Date.now()}.css`);
    tmpFiles.push(tmpContent, tmpTokens);
    await writeFile(tmpContent, '# D\n', 'utf8');
    await writeFile(tmpTokens, ':root{}\n', 'utf8');
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ ok: true }));
    const contentCode = await runCli(['design-systems', 'content', 'ds1', '--file', tmpContent], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    const tokensCode = await runCli(['design-systems', 'tokens', 'ds1', '--file', tmpTokens], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    expect(contentCode).toBe(EXIT.OK);
    expect(tokensCode).toBe(EXIT.OK);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toContain('/content');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ content: '# D\n' });
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toContain('/tokens');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ content: ':root{}\n' });
  });

  it('unknown subcommand and missing id → EXIT.USAGE with the new usage string', async () => {
    const err: string[] = [];
    const nope = await runCli(['design-systems', 'nope'], {
      stdout: () => {},
      stderr: (s) => err.push(s),
    });
    expect(nope).toBe(EXIT.USAGE);
    expect(err.join('')).toMatch(/content/);
    expect(err.join('')).toMatch(/rules/);
    expect(err.join('')).toMatch(/tokens/);

    expect(await runCli(['design-systems', 'rules'], { stdout: () => {}, stderr: () => {} })).toBe(
      EXIT.USAGE,
    );
    expect(
      await runCli(['design-systems', 'append', 'ds1'], { stdout: () => {}, stderr: () => {} }),
    ).toBe(EXIT.USAGE);
    expect(
      await runCli(['design-systems', 'prune', 'ds1'], { stdout: () => {}, stderr: () => {} }),
    ).toBe(EXIT.USAGE);
    expect(
      await runCli(['design-systems', 'components', 'ds1'], { stdout: () => {}, stderr: () => {} }),
    ).toBe(EXIT.USAGE);
    expect(
      await runCli(['design-systems', 'starters', 'ds1'], { stdout: () => {}, stderr: () => {} }),
    ).toBe(EXIT.USAGE);
    expect(
      await runCli(['design-systems', 'rules', 'ds1', '--file'], {
        stdout: () => {},
        stderr: () => {},
      }),
    ).toBe(EXIT.USAGE);
  });

  it('help lists design-systems content/rules/tokens', async () => {
    const lines: string[] = [];
    const code = await runCli(['help'], { stdout: (s) => lines.push(s), stderr: () => {} });
    expect(code).toBe(EXIT.OK);
    expect(lines.join('')).toMatch(/design-systems/);
    expect(lines.join('')).toMatch(/content/);
    expect(lines.join('')).toMatch(/rules/);
    expect(lines.join('')).toMatch(/tokens/);

    const usage: string[] = [];
    const empty = await runCli([], { stdout: (s) => usage.push(s), stderr: () => {} });
    expect(empty).toBe(EXIT.USAGE);
    expect(usage.join('')).toMatch(/Usage/);
  });

  it('--json GET prints JSON data; --json PUT prints JSON', async () => {
    const tmpRules = join(tmpdir(), `neos-cli-ds-json-${process.pid}-${Date.now()}.md`);
    tmpFiles.push(tmpRules);
    await writeFile(tmpRules, '# Agent rules\n', 'utf8');
    const { fetchImpl } = recordFetch((url, init) => {
      if (init?.method === 'PUT') return jsonResponse({ ok: true, data: { ok: true } });
      return jsonResponse({ ok: true, data: { content: '# Agent rules\n' } });
    });
    const getLines: string[] = [];
    const getCode = await runCli(['--json', 'design-systems', 'rules', 'ds1'], {
      fetchImpl,
      env,
      stdout: (s) => getLines.push(s),
      stderr: () => {},
    });
    expect(getCode).toBe(EXIT.OK);
    expect(JSON.parse(getLines.join(''))).toMatchObject({ content: '# Agent rules\n' });

    const putLines: string[] = [];
    const putCode = await runCli(
      ['--json', 'design-systems', 'rules', 'ds1', '--file', tmpRules],
      {
        fetchImpl,
        env,
        stdout: (s) => putLines.push(s),
        stderr: () => {},
      },
    );
    expect(putCode).toBe(EXIT.OK);
    expect(() => JSON.parse(putLines.join(''))).not.toThrow();
  });

  it('GET 404 maps to EXIT.NOT_FOUND', async () => {
    const { fetchImpl } = recordFetch(() => jsonResponse({ ok: false, error: 'Not found' }, 404));
    const code = await runCli(['design-systems', 'rules', 'ds1'], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.NOT_FOUND);
  });

  it('PUT --file missing path on disk → EXIT.VALIDATION; no PUT', async () => {
    const missing = join(tmpdir(), `neos-cli-ds-missing-${process.pid}.md`);
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ ok: true }));
    const code = await runCli(['design-systems', 'rules', 'ds1', '--file', missing], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.VALIDATION);
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('PUT --file with null byte → EXIT.VALIDATION; no PUT', async () => {
    const tmpRules = join(tmpdir(), `neos-cli-ds-null-${process.pid}-${Date.now()}.md`);
    tmpFiles.push(tmpRules);
    await writeFile(tmpRules, `ok${'\0'}bad`, 'utf8');
    const { fetchImpl, calls } = recordFetch(() => jsonResponse({ ok: true }));
    const code = await runCli(['design-systems', 'rules', 'ds1', '--file', tmpRules], {
      fetchImpl,
      env,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(EXIT.VALIDATION);
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('source scan: CLI design-systems command has no append/prune/components/starters branches', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'commands/design-systems.ts'), 'utf8');
    expect(src).not.toMatch(/sub === ['"]append['"]/);
    expect(src).not.toMatch(/sub === ['"]prune['"]/);
    expect(src).not.toMatch(/sub === ['"]components['"]/);
    expect(src).not.toMatch(/sub === ['"]starters['"]/);
  });
});
