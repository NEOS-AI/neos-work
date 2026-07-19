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

  it('requires a query', async () => {
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, {}));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const result = await node.execute(ctx({ TAVILY_API_KEY: 'tvly' }, { query: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
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
});
