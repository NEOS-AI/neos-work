/**
 * WebSearchNode — calls Tavily Search API to retrieve web results.
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveMaxResults, resolveSearchQuery } from './message-text.js';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export class WebSearchNode implements ExecutableNode {
  type = 'web_search' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const apiKey = ctx.settings['TAVILY_API_KEY'];
    if (!apiKey) {
      return { ok: false, output: null, error: 'TAVILY_API_KEY not set', durationMs: 0 };
    }

    const query = resolveSearchQuery(ctx.config, ctx.inputs);
    if (!query) {
      return { ok: false, output: null, error: 'No query provided', durationMs: 0 };
    }

    const maxResults = resolveMaxResults(ctx.config, 5);

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          output: null,
          error: `Tavily API error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      const data = await res.json() as { results: TavilyResult[] };
      return {
        ok: true,
        output: data.results,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : 'Web search failed',
        durationMs: Date.now() - start,
      };
    }
  }
}
