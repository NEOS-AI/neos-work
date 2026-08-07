/**
 * Harness HTTP aliases removed in v0.10.2 (Q33).
 *
 * All `/api/harness` and `/api/harnesses` methods return **410 Gone** with a
 * successor pointer to `/api/workers`. Prefer Domain Workers API.
 *
 * Historical CRUD lived here as a v0.4 deprecation alias over workers.
 */

import { Hono } from 'hono';

const harness = new Hono();

const GONE_ERROR =
  'Gone: /api/harness and /api/harnesses were removed in 0.10.2. Use /api/workers instead.';

const GONE_BODY = {
  ok: false as const,
  error: GONE_ERROR,
  data: {
    successor: '/api/workers',
    removedIn: '0.10.2',
  },
};

function gone(c: {
  header: (k: string, v: string) => void;
  json: (body: unknown, status?: number) => Response;
}) {
  // Header values must be ASCII ByteString (no em-dash / fancy punctuation)
  c.header('Deprecation', 'true');
  c.header('Link', '</api/workers>; rel="successor-version"');
  c.header('X-Neos-Deprecated', 'Use /api/workers - harness HTTP aliases removed in 0.10.2');
  return c.json(GONE_BODY, 410);
}

// Every method on this mount is gone (list, :id, nested)
harness.all('*', (c) => gone(c));

export default harness;
