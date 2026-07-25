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

  it('filters non-http result URLs', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'A', url: 'javascript:alert(1)', content: 'x' },
            { title: 'B', url: 'https://ok.example', content: 'y' },
            { title: 'C', url: 'file:///etc/passwd', content: 'z' },
            { title: 'D', url: 'https://two.example', content: 'w' },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;
    const result = await createWebSearchTool().execute({ query: 'q', maxResults: 10 });
    expect(result.success).toBe(true);
    const out = result.output as { results: Array<{ url: string }> };
    expect(out.results.map((r) => r.url)).toEqual([
      'https://ok.example',
      'https://two.example',
    ]);
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

  it('defaults maxResults to 5 and tolerates missing results array', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as typeof fetch;
    const result = await createWebSearchTool().execute({ query: 'q' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ results: [] });
    const body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.max_results).toBe(5);
  });

  it('surfaces network failures as tool errors', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    const result = await createWebSearchTool().execute({ query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNRESET/);
  });

  it('rejects blank query and whitespace-only API key', async () => {
    process.env['TAVILY_API_KEY'] = '  ';
    const missingKey = await createWebSearchTool().execute({ query: 'q' });
    expect(missingKey.success).toBe(false);
    expect(missingKey.error).toMatch(/TAVILY_API_KEY/);

    process.env['TAVILY_API_KEY'] = 'k';
    const blank = await createWebSearchTool().execute({ query: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error).toMatch(/query/i);
  });

  it('rejects control-char queries and truncates long queries / snippets', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    const ctrl = await createWebSearchTool().execute({ query: `bad${'\n'}q` });
    expect(ctrl.success).toBe(false);
    expect(ctrl.error).toMatch(/control characters/i);
    // Leading control char must not be stripped to a valid query
    const lead = await createWebSearchTool().execute({ query: '\nhello' });
    expect(lead.success).toBe(false);
    expect(lead.error).toMatch(/control characters/i);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'T'.repeat(800),
              url: 'https://example.com',
              content: 'S'.repeat(5_000),
            },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const longQ = 'q'.repeat(3_000);
    const result = await createWebSearchTool().execute({ query: longQ });
    expect(result.success).toBe(true);
    const body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    );
    expect(body.query.length).toBe(2_000);
    const out = result.output as { results: Array<{ title: string; snippet: string }> };
    expect(out.results[0]!.title.length).toBe(500);
    expect(out.results[0]!.snippet.length).toBe(2_000);
  });


  it('floors and clamps maxResults (string/zero/negative)', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as typeof fetch;

    await createWebSearchTool().execute({ query: '  hello  ', maxResults: '3.9' as never });
    let body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.query).toBe('hello');
    expect(body.max_results).toBe(3);

    await createWebSearchTool().execute({ query: 'q', maxResults: 0 });
    body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(body.max_results).toBe(1);

    await createWebSearchTool().execute({ query: 'q', maxResults: -5 });
    body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2][1] as RequestInit).body as string,
    );
    expect(body.max_results).toBe(1);

    await createWebSearchTool().execute({ query: 'q', maxResults: Number.NaN });
    body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[3][1] as RequestInit).body as string,
    );
    expect(body.max_results).toBe(5);

    await createWebSearchTool().execute({
      query: 99 as unknown as string,
      maxResults: 'not-a-number' as never,
    });
    body = JSON.parse(
      ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[4][1] as RequestInit).body as string,
    );
    expect(body.query).toBe('99');
    expect(body.max_results).toBe(5);
  });

  it('rejects control-char or overlong TAVILY_API_KEY before fetch', async () => {
    process.env['TAVILY_API_KEY'] = `tv${'\n'}ly`;
    const ctrl = await createWebSearchTool().execute({ query: 'q' });
    expect(ctrl.success).toBe(false);
    expect(ctrl.error).toMatch(/invalid/i);

    process.env['TAVILY_API_KEY'] = `tv${'\0'}ly`;
    const nul = await createWebSearchTool().execute({ query: 'q' });
    expect(nul.success).toBe(false);
    expect(nul.error).toMatch(/invalid/i);

    process.env['TAVILY_API_KEY'] = 'k'.repeat(9_000);
    const long = await createWebSearchTool().execute({ query: 'q' });
    expect(long.success).toBe(false);
    expect(long.error).toMatch(/invalid/i);
  });

  it('drops overlong / control-char result URLs and sends User-Agent', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'ok', url: 'https://good.example/path', content: 'a' },
            { title: 'ctrl', url: `https://bad.example/${'\n'}x`, content: 'b' },
            { title: 'long', url: `https://x.example/${'p'.repeat(2_100)}`, content: 'c' },
            { title: 'empty', url: '   ', content: 'd' },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const result = await createWebSearchTool().execute({ query: 'q' });
    expect(result.success).toBe(true);
    const out = result.output as { results: Array<{ url: string; title: string }> };
    expect(out.results).toEqual([{ title: 'ok', url: 'https://good.example/path', snippet: 'a' }]);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^neos-work\//);
  });

  it('stringifies non-Error throwables from fetch', async () => {
    process.env['TAVILY_API_KEY'] = 'k';
    globalThis.fetch = vi.fn(async () => {
      throw 'network-down';
    }) as typeof fetch;
    const result = await createWebSearchTool().execute({ query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('network-down');
  });
});
