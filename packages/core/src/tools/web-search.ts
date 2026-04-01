/**
 * Web search tool — searches the web using DuckDuckGo Instant Answer API.
 * No API key required. SSRF-protected.
 */

import type { Tool, ToolResult } from './base.js';

const PRIVATE_IP_RANGES = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(hostname));
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
      try {
        const query = input.query as string;
        const maxResults = Math.min((input.maxResults as number) ?? 5, 10);

        const url = new URL('https://api.duckduckgo.com/');
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('no_html', '1');
        url.searchParams.set('skip_disambig', '1');

        // SSRF protection
        if (isPrivateHost(url.hostname)) {
          return { success: false, output: null, error: 'Requests to private/internal hosts are blocked' };
        }

        const response = await fetch(url.toString(), {
          signal: AbortSignal.timeout(10_000),
          headers: { 'User-Agent': 'neos-work/0.1.2' },
        });

        if (!response.ok) {
          return { success: false, output: null, error: `Search API returned ${response.status}` };
        }

        const data = await response.json() as Record<string, unknown>;
        const results: { title: string; url: string; snippet: string }[] = [];

        // Abstract (top result)
        if (data.Abstract && data.AbstractURL) {
          results.push({
            title: (data.Heading as string) || query,
            url: data.AbstractURL as string,
            snippet: data.Abstract as string,
          });
        }

        // Related topics
        const topics = (data.RelatedTopics as Array<Record<string, unknown>>) ?? [];
        for (const topic of topics) {
          if (results.length >= maxResults) break;
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: (topic.Text as string).split(' - ')[0] ?? (topic.Text as string),
              url: topic.FirstURL as string,
              snippet: topic.Text as string,
            });
          }
        }

        // Fallback if DDG returned nothing
        if (results.length === 0) {
          return {
            success: true,
            output: {
              results: [],
              note: 'No results found. The query may be too specific or DuckDuckGo has no instant answer.',
            },
          };
        }

        return { success: true, output: { results } };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}
