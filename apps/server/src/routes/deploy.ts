/**
 * Deploy routes
 * POST /api/deploy  — Deploy content to Vercel or Cloudflare
 */

import { Hono } from 'hono';
import { getSetting } from '../db/settings.js';
import { deployToVercel, deployToCloudflare } from '../lib/deploy.js';

const deploy = new Hono();

deploy.post('/', async (c) => {
  const body = await c.req.json<{
    provider: 'vercel' | 'cloudflare';
    content: string;
    projectName?: string;
  }>();

  if (!body.provider || !body.content) {
    return c.json({ ok: false, error: 'provider and content are required' }, 400);
  }
  if (!['vercel', 'cloudflare'].includes(body.provider)) {
    return c.json({ ok: false, error: 'provider must be vercel or cloudflare' }, 400);
  }
  if (body.content.length > 5_000_000) {
    return c.json({ ok: false, error: 'content too large' }, 400);
  }

  const projectName = body.projectName ?? 'neos-deploy';

  try {
    if (body.provider === 'vercel') {
      const apiToken = getSetting('VERCEL_API_TOKEN');
      if (!apiToken) return c.json({ ok: false, error: 'Vercel API token not configured' }, 400);
      const result = await deployToVercel({ projectName, content: body.content, apiToken });
      return c.json({ ok: true, data: result });
    } else {
      const apiToken = getSetting('CLOUDFLARE_API_TOKEN');
      const accountId = getSetting('CLOUDFLARE_ACCOUNT_ID');
      if (!apiToken || !accountId) {
        return c.json({ ok: false, error: 'Cloudflare API token and Account ID not configured' }, 400);
      }
      const result = await deployToCloudflare({ projectName, content: body.content, accountId, apiToken });
      return c.json({ ok: true, data: result });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Deploy failed';
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default deploy;
