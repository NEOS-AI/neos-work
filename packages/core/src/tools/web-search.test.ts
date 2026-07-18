import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSearchTool } from './web-search.js';

describe('createWebSearchTool', () => {
  const originalKey = process.env['TAVILY_API_KEY'];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalKey === undefined) delete process.env['TAVILY_API_KEY'];
    else process.env['TAVILY_API_KEY'] = originalKey;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fails when API key is missing', async () => {
    delete process.env['TAVILY_API_KEY'];
    const result = await createWebSearchTool().execute({ query: 'neos' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/TAVILY_API_KEY/);
  });

  it('maps successful Tavily responses', async () => {
    process.env['TAVILY_API_KEY'] = 'test-key';
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ title: 'T', url: 'https://example.com', content: 'snippet' }],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await createWebSearchTool().execute({ query: 'q', maxResults: 3 });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      results: [{ title: 'T', url: 'https://example.com', snippet: 'snippet' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.max_results).toBe(3);
    expect(body.api_key).toBe('test-key');
  });

  it('caps maxResults at 10', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as typeof fetch;
    await createWebSearchTool().execute({ query: 'q', maxResults: 50 });
    const body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.max_results).toBe(10);
  });

  it('returns API error status', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as typeof fetch;
    const result = await createWebSearchTool().execute({ query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/429/);
  });
});
