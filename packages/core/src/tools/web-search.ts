/**
 * Web search tool — searches the web using Tavily Search API.
 * Requires TAVILY_API_KEY environment variable.
 */

import { scrubErrorMessage, type Tool, type ToolResult } from './base.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

function clampMaxResults(raw: unknown, fallback = 5): number {
  // Control-char numeric strings are invalid (check before trim)
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && !/[\0\r\n]/.test(raw) && raw.trim()
        ? Number(raw.trim())
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
      const apiKeyRaw =
        typeof process.env['TAVILY_API_KEY'] === 'string' ? process.env['TAVILY_API_KEY'] : '';
      // Reject control chars / pathological key lengths before calling Tavily
      if (/[\0\r\n]/.test(apiKeyRaw) || apiKeyRaw.length > 8_192) {
        return { success: false, output: null, error: 'TAVILY_API_KEY is invalid' };
      }
      const apiKey = apiKeyRaw.trim();
      if (!apiKey) {
        return { success: false, output: null, error: 'TAVILY_API_KEY is not set' };
      }

      try {
        /** Cap query length (align with WebSearchNode SEARCH_QUERY_MAX_CHARS). */
        const SEARCH_QUERY_MAX = 2_000;
        const SNIPPET_MAX = 2_000;
        const TITLE_MAX = 500;
        const queryRaw =
          typeof input.query === 'string' ? input.query : String(input.query ?? '');
        // Control-char check before trim
        if (/[\0\r\n]/.test(queryRaw)) {
          return {
            success: false,
            output: null,
            error: 'query contains invalid control characters',
          };
        }
        let query = queryRaw.trim();
        if (!query) {
          return { success: false, output: null, error: 'query is required' };
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
            'User-Agent': 'neos-work/0.5.8',
          },
          body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          // Scrub control chars from upstream error bodies
          const detail = text.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
          return {
            success: false,
            output: null,
            error: detail
              ? `Tavily API returned ${response.status}: ${detail}`
              : `Tavily API returned ${response.status}`,
          };
        }

        const data = await response.json() as {
          results?: Array<{ title?: string; url?: string; content?: string }>;
        };
        const rawResults = Array.isArray(data.results) ? data.results : [];
        const results = rawResults
          .slice(0, maxResults)
          .map((r) => {
            // Scrub control chars from title/snippet (result hygiene)
            let title = '';
            if (typeof r.title === 'string' && !/[\0\r\n]/.test(r.title)) {
              title = r.title.trim().slice(0, TITLE_MAX);
            }
            const urlRaw = typeof r.url === 'string' ? r.url : '';
            // Only keep http(s) result URLs (drop javascript:/file: noise)
            let safeUrl = '';
            if (urlRaw && urlRaw.length <= 2_048 && !/[\0\r\n]/.test(urlRaw)) {
              const url = urlRaw.trim();
              try {
                const u = new URL(url);
                if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = url;
              } catch {
                safeUrl = '';
              }
            }
            let snippet = '';
            if (typeof r.content === 'string' && !/[\0]/.test(r.content)) {
              // Collapse CR/LF in snippets for single-line display
              snippet = r.content.replace(/[\r\n]+/g, ' ').trim().slice(0, SNIPPET_MAX);
            }
            return { title, url: safeUrl, snippet };
          })
          .filter((r) => r.url.length > 0);

        return { success: true, output: { results } };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: scrubErrorMessage(err instanceof Error ? err.message : String(err)) || 'Operation failed',
        };
      }
    },
  };
}
