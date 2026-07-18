import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchNode } from './web-search.js';
import type { NodeContext } from '../types.js';

function ctx(settings: Record<string, string>, inputs: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'search',
    inputs,
    settings,
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
});
