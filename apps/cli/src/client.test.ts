import { describe, expect, it, vi } from 'vitest';
import { CliHttpError, NeosApiClient } from './client.js';
import { EXIT } from './exit-codes.js';
import type { CliConfig } from './config.js';

const cfg: CliConfig = {
  serverUrl: 'http://127.0.0.1:3000',
  authToken: 'tok',
  projectId: null,
  projectDir: null,
  timeoutMs: 5_000,
};

describe('NeosApiClient', () => {
  it('sends Authorization header', async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      return new Response(JSON.stringify({ ok: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = new NeosApiClient(cfg, fetchImpl);
    await client.listProjects();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('throws DAEMON_DOWN on connection refused', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const client = new NeosApiClient(cfg, fetchImpl);
    await expect(client.listProjects()).rejects.toMatchObject({
      exitCode: EXIT.DAEMON_DOWN,
    });
  });

  it('throws CliHttpError on 404', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const client = new NeosApiClient(cfg, fetchImpl);
    await expect(client.getProject('missing')).rejects.toBeInstanceOf(CliHttpError);
    await expect(client.getProject('missing')).rejects.toMatchObject({
      exitCode: EXIT.NOT_FOUND,
    });
  });

  it('findSkills / addSkill / updateSkill / removeSkill hit catalog routes', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = new NeosApiClient(cfg, fetchImpl);
    await client.findSkills('find', { owner: 'vercel-labs' });
    await client.addSkill({ source: 'vercel-labs/skills', slug: 'find-skills', confirm: true });
    await client.updateSkill('skill-1');
    await client.removeSkill('skill-1');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toMatch(/\/api\/skills\/catalog\/search\?/);
    expect(calls[0]?.url).toContain('q=find');
    expect(calls[0]?.url).toContain('owner=vercel-labs');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.url).toMatch(/\/api\/skills\/install$/);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toMatchObject({
      source: 'vercel-labs/skills',
      slug: 'find-skills',
      confirm: true,
    });
    expect(calls[2]?.method).toBe('POST');
    expect(calls[2]?.url).toMatch(/\/api\/skills\/skill-1\/update$/);
    expect(calls[3]?.method).toBe('DELETE');
    expect(calls[3]?.url).toMatch(/\/api\/skills\/skill-1$/);
  });

  it('listCliAgents and listCliAgentsCatalog hit expected paths', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      return new Response(JSON.stringify({ ok: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const client = new NeosApiClient(cfg, fetchImpl);
    await client.listCliAgents();
    await client.listCliAgentsCatalog();
    expect(urls[0]).toMatch(/\/api\/cli-agents$/);
    expect(urls[1]).toMatch(/\/api\/cli-agents\/catalog$/);
  });
});
