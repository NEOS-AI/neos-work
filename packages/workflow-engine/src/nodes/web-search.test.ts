import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchNode } from './web-search.js';
import type { NodeContext } from '../types.js';

function ctx(
  settings: Record<string, string>,
  inputs: Record<string, unknown> = {},
  config?: Record<string, unknown>,
): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'search',
    inputs,
    settings,
    config,
  };
}

describe('WebSearchNode', () => {
  const node = new WebSearchNode();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires TAVILY_API_KEY', async () => {
    const result = await node.execute(ctx({}, { query: 'hello' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TAVILY_API_KEY/);
  });

  it('treats whitespace-only TAVILY_API_KEY as missing', async () => {
    const result = await node.execute(ctx({ TAVILY_API_KEY: '   ' }, { query: 'hello' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TAVILY_API_KEY/);
  });

  it('requires a query', async () => {
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, {}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No query/);
  });

  it('rejects whitespace-only query from inputs', async () => {
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No query/);
  });

  it('returns Tavily results on success', async () => {
    const results = [{ title: 'A', url: 'https://a.test', content: 'c', score: 0.9 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results }),
    }));
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'neos' }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(results);
  });

  it('surfaces non-ok HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
    expect(result.error).toMatch(/rate limited/);
  });

  it('sends User-Agent and tolerates missing results array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual([]);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^neos-work\//);
  });

  it('uses config.query and config.maxResults for the Tavily request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await node.execute(
      ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'from-input' }, { query: 'from-config', maxResults: 12 }),
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.query).toBe('from-config');
    expect(body.max_results).toBe(12);
  });

  it('uses inputs.text when config.query missing and clamps oversized maxResults', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await node.execute(
      ctx({ TAVILY_API_KEY: 'tvly' }, { text: 'from-text' }, { maxResults: 99 }),
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.query).toBe('from-text');
    expect(body.max_results).toBe(20);
  });

  it('surfaces fetch/network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/);
  });

  it('truncates long non-ok response bodies and handles empty bodies', async () => {
    const longBody = 'e'.repeat(800);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => longBody,
    }));
    const withBody = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(withBody.ok).toBe(false);
    expect(withBody.error).toMatch(/500/);
    expect(withBody.error!.length).toBeLessThan(longBody.length + 40);
    expect(withBody.error).not.toContain('e'.repeat(600));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '   ',
    }));
    const emptyBody = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(emptyBody.error).toBe('Tavily API error: 503');
  });

  it('stringifies non-Error network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('boom'));
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Web search failed');
  });

  it('trims padded API key before calling Tavily', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await node.execute(ctx({ TAVILY_API_KEY: '  tvly-key  ' }, { query: 'q' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.api_key).toBe('tvly-key');
  });
});
