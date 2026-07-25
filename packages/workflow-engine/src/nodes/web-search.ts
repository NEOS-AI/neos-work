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
    const apiKeyRaw = String(ctx.settings['TAVILY_API_KEY'] ?? '');
    // Reject control chars before trim / pathological key lengths before calling Tavily
    const API_KEY_MAX = 8_192;
    if (/[\0\r\n]/.test(apiKeyRaw) || apiKeyRaw.trim().length > API_KEY_MAX) {
      return {
        ok: false,
        output: null,
        error: 'TAVILY_API_KEY is invalid',
        durationMs: 0,
      };
    }
    const apiKey = apiKeyRaw.trim();
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
          'User-Agent': 'neos-work/0.3.140',
        },
        body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Scrub control chars from upstream error bodies
        const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
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
          let title = '';
          if (typeof r.title === 'string' && !/[\0\r\n]/.test(r.title)) {
            title = r.title.trim().slice(0, 500);
          }
          let content = '';
          if (typeof r.content === 'string' && !/\0/.test(r.content)) {
            content = r.content.replace(/[\r\n]+/g, ' ').trim().slice(0, 2_000);
          }
          const urlRaw = typeof r.url === 'string' ? r.url : '';
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
