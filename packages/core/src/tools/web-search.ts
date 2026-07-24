/**
 * Web search tool — searches the web using Tavily Search API.
 * Requires TAVILY_API_KEY environment variable.
 */

import type { Tool, ToolResult } from './base.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

function clampMaxResults(raw: unknown, fallback = 5): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

export function createWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description:
      'Search the web for current information. Returns a list of results with title, URL, and snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
    async execute(input): Promise<ToolResult> {
      const apiKey =
        typeof process.env['TAVILY_API_KEY'] === 'string'
          ? process.env['TAVILY_API_KEY'].trim()
          : '';
      if (!apiKey) {
        return { success: false, output: null, error: 'TAVILY_API_KEY is not set' };
      }

      try {
        /** Cap query length (align with WebSearchNode SEARCH_QUERY_MAX_CHARS). */
        const SEARCH_QUERY_MAX = 2_000;
        const SNIPPET_MAX = 2_000;
        const TITLE_MAX = 500;
        let query =
          typeof input.query === 'string' ? input.query.trim() : String(input.query ?? '').trim();
        if (!query) {
          return { success: false, output: null, error: 'query is required' };
        }
        if (/[\0\r\n]/.test(query)) {
          return {
            success: false,
            output: null,
            error: 'query contains invalid control characters',
          };
        }
        if (query.length > SEARCH_QUERY_MAX) {
          query = query.slice(0, SEARCH_QUERY_MAX);
        }
        const maxResults = clampMaxResults(input.maxResults, 5);

        const response = await fetch(TAVILY_ENDPOINT, {
          method: 'POST',
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'neos-work/0.3.100',
          },
          body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return {
            success: false,
            output: null,
            error: `Tavily API returned ${response.status}: ${text.slice(0, 500)}`,
          };
        }

        const data = await response.json() as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const rawResults = Array.isArray(data.results) ? data.results : [];
        const results = rawResults
          .slice(0, maxResults)
          .map((r) => {
            const title = typeof r.title === 'string' ? r.title.trim().slice(0, TITLE_MAX) : '';
            const url = typeof r.url === 'string' ? r.url.trim() : '';
            // Only keep http(s) result URLs (drop javascript:/file: noise)
            let safeUrl = '';
            try {
              const u = new URL(url);
              if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = url;
            } catch {
              safeUrl = '';
            }
            const snippet =
              typeof r.content === 'string' ? r.content.trim().slice(0, SNIPPET_MAX) : '';
            return { title, url: safeUrl, snippet };
          })
          .filter((r) => r.url.length > 0);

        return { success: true, output: { results } };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
