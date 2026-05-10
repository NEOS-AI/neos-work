/**
 * Web search tool — searches the web using Tavily Search API.
 * Requires TAVILY_API_KEY environment variable.
 */

import type { Tool, ToolResult } from './base.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

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
      const apiKey = process.env['TAVILY_API_KEY'];
      if (!apiKey) {
        return { success: false, output: null, error: 'TAVILY_API_KEY is not set' };
      }

      try {
        const query = input.query as string;
        const maxResults = Math.min((input.maxResults as number) ?? 5, 10);

        const response = await fetch(TAVILY_ENDPOINT, {
          method: 'POST',
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'neos-work/0.2.0',
          },
          body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { success: false, output: null, error: `Tavily API returned ${response.status}: ${text}` };
        }

        const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
        const results = (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        }));

        return { success: true, output: { results } };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}
