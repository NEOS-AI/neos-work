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
          'User-Agent': 'neos-work/0.3.101',
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
      const raw = Array.isArray(data.results) ? data.results : [];
      // Clip fields; only keep http(s) URLs; respect maxResults
      const results = raw
        .slice(0, maxResults)
        .map((r) => {
          const title = typeof r.title === 'string' ? r.title.trim().slice(0, 500) : '';
          const content =
            typeof r.content === 'string' ? r.content.trim().slice(0, 2_000) : '';
          const url = typeof r.url === 'string' ? r.url.trim() : '';
          let safeUrl = '';
          try {
            const u = new URL(url);
            if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = url;
          } catch {
            safeUrl = '';
          }
          return {
            title,
            url: safeUrl,
            content,
            score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0,
          };
        })
        .filter((r) => r.url.length > 0);
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
