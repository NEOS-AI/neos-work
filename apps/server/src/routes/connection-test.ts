/**
 * Connection test API (Task 14).
 * Probes provider reachability without returning secrets.
 *
 * POST /api/connection-test
 * body: { target: 'openai' | 'anthropic' | 'ollama' | 'url', url?: string }
 */

import { Hono } from 'hono';
import { getSecretSetting } from '../db/settings.js';
import { publicErrorMessage } from '../lib/errors.js';
import {
  assertSafeOutboundUrl,
  isBlockedSsrfHost,
  parseHttpUrl,
  SsrfError,
} from '../lib/ssrf.js';

const connectionTest = new Hono();

type Target = 'openai' | 'anthropic' | 'ollama' | 'url' | 'cli-agents';

const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/messages',
  ollama: 'http://127.0.0.1:11434/api/tags',
};

connectionTest.post('/', async (c) => {
  const body = await c.req.json<{ target?: string; url?: string }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const targetRaw = typeof body.target === 'string' ? body.target : '';
  if (!targetRaw || /[\0\r\n]/.test(targetRaw)) {
    return c.json({ ok: false, error: 'target is required' }, 400);
  }
  const target = targetRaw.trim().toLowerCase() as Target;

  if (target === 'cli-agents') {
    // Local catalog smoke only — no network
    try {
      const { AGENT_CLI_DEFS } = await import('@neos-work/agent-runtime');
      const count = AGENT_CLI_DEFS.length;
      return c.json({
        ok: true,
        data: {
          target: 'cli-agents',
          reachable: true,
          catalogCount: count,
          message: `${count} CLI agent defs registered`,
        },
      });
    } catch (err) {
      return c.json({
        ok: false,
        error: publicErrorMessage(err, 'cli-agents catalog unavailable'),
      }, 500);
    }
  }

  let probeUrl: string;
  // Private hosts only for user-configured local providers (Ollama / OpenAI-compat base)
  let allowPrivate = false;

  if (target === 'url') {
    if (typeof body.url !== 'string' || /[\0\r\n]/.test(body.url)) {
      return c.json({ ok: false, error: 'url is required for target=url' }, 400);
    }
    probeUrl = body.url.trim();
  } else if (target === 'openai' || target === 'anthropic' || target === 'ollama') {
    if (target === 'openai') {
      const base = getSecretSetting('OPENAI_BASE_URL');
      if (base) {
        probeUrl = `${base.replace(/\/+$/, '')}/models`;
        // BYOK OpenAI-compatible often runs on loopback — allow private for configured base only
        allowPrivate = true;
      } else {
        probeUrl = PROVIDER_DEFAULTS.openai!;
      }
    } else if (target === 'ollama') {
      const base = getSecretSetting('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';
      probeUrl = `${base.replace(/\/+$/, '')}/api/tags`;
      allowPrivate = true; // intentional local Ollama
    } else {
      probeUrl = PROVIDER_DEFAULTS.anthropic!;
    }
  } else {
    return c.json({
      ok: false,
      error: 'target must be openai|anthropic|ollama|url|cli-agents',
    }, 400);
  }

  try {
    let url: URL;
    if (allowPrivate) {
      url = parseHttpUrl(probeUrl, { allowPrivateHost: true });
    } else {
      // checkDns false for connection-test latency; host literal still blocked
      url = await assertSafeOutboundUrl(probeUrl, { checkDns: false });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'neos-work-connection-test/0.5.28' },
      });
      // Redirect check
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location') ?? '';
        if (loc && !/[\0\r\n]/.test(loc)) {
          try {
            const next = new URL(loc, url.href);
            if (!allowPrivate && isBlockedSsrfHost(next.hostname)) {
              return c.json({
                ok: true,
                data: {
                  target,
                  reachable: false,
                  blocked: true,
                  status: res.status,
                  message: 'Redirect target is blocked',
                },
              });
            }
          } catch {
            // ignore
          }
        }
      }
      const reachable = res.status > 0 && res.status < 600;
      return c.json({
        ok: true,
        data: {
          target,
          reachable,
          blocked: false,
          status: res.status,
          // Do not include response body (may leak)
          message:
            res.status === 401 || res.status === 403
              ? 'Endpoint reachable (auth required — expected without key)'
              : res.ok
                ? 'Endpoint reachable'
                : `HTTP ${res.status}`,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof SsrfError) {
      return c.json({
        ok: true,
        data: {
          target,
          reachable: false,
          blocked: err.code === 'blocked_host' || err.code === 'blocked_dns',
          message: err.message,
        },
      });
    }
    const msg = publicErrorMessage(err, 'Connection test failed');
    const aborted = err instanceof Error && err.name === 'AbortError';
    return c.json({
      ok: true,
      data: {
        target,
        reachable: false,
        blocked: false,
        message: aborted ? 'Timed out' : msg,
      },
    });
  }
});

export default connectionTest;
