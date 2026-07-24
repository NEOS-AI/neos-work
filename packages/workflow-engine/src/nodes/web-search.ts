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
    const apiKey = String(ctx.settings['TAVILY_API_KEY'] ?? '').trim();
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
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'neos-work/0.3.86',
        },
        body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const detail = body.trim().slice(0, 500);
        return {
          ok: false,
          output: null,
          error: detail
            ? `Tavily API error: ${res.status}: ${detail}`
            : `Tavily API error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      const data = await res.json() as { results?: TavilyResult[] };
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        ok: true,
        output: results,
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
