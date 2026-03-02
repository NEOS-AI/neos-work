import { Hono } from 'hono';

import { ProviderRegistry, AnthropicAdapter, GoogleAdapter } from '@neos-work/core';

import * as settingsDb from '../db/settings.js';
import { isSensitiveKey } from '../db/crypto.js';

/** Mask sensitive values so full secrets are never returned via API. */
function maskValue(key: string, value: string): string {
  if (!isSensitiveKey(key)) return value;
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

const settings = new Hono();

// GET /api/settings — all settings (sensitive values masked)
settings.get('/', (c) => {
  const all = settingsDb.getAllSettings();
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    masked[key] = maskValue(key, value);
  }
  return c.json({ ok: true, data: masked });
});

// GET /api/settings/:key — single setting (sensitive values masked)
settings.get('/:key', (c) => {
  const key = c.req.param('key');
  const value = settingsDb.getSetting(key);
  if (value === undefined) {
    return c.json({ ok: false, error: 'Setting not found' }, 404);
  }
  return c.json({ ok: true, data: { key, value: maskValue(key, value) } });
});

// PUT /api/settings/:key — create or update setting
settings.put('/:key', async (c) => {
  const key = c.req.param('key');

  // Validate key format (alphanumeric, dots, hyphens, underscores; max 100 chars)
  if (!key || key.length > 100 || !/^[a-zA-Z0-9_.-]+$/.test(key)) {
    return c.json({ ok: false, error: 'Invalid setting key' }, 400);
  }

  const body = await c.req.json<{ value: string }>();
  if (body.value === undefined) {
    return c.json({ ok: false, error: 'Missing "value" in body' }, 400);
  }

  // Limit value size to prevent memory abuse (1 MB)
  if (typeof body.value !== 'string' || body.value.length > 1_000_000) {
    return c.json({ ok: false, error: 'Setting value too large or invalid type' }, 400);
  }

  settingsDb.setSetting(key, body.value);
  return c.json({ ok: true });
});

// DELETE /api/settings/:key — delete setting
settings.delete('/:key', (c) => {
  const key = c.req.param('key');
  const deleted = settingsDb.deleteSetting(key);
  if (!deleted) return c.json({ ok: false, error: 'Setting not found' }, 404);
  return c.json({ ok: true });
});

// POST /api/settings/verify-key — validate an API key
settings.post('/verify-key', async (c) => {
  const body = await c.req.json<{ provider: string; key: string }>();
  if (!body.provider || !body.key) {
    return c.json({ ok: false, error: 'Missing provider or key' }, 400);
  }

  try {
    const registry = new ProviderRegistry();
    if (body.provider === 'anthropic') {
      registry.register(new AnthropicAdapter(body.key));
    } else if (body.provider === 'google') {
      registry.register(new GoogleAdapter(body.key));
    } else {
      return c.json({ ok: false, error: `Unknown provider: ${body.provider}` }, 400);
    }

    const adapter = registry.get(body.provider as 'anthropic' | 'google')!;
    const valid = await adapter.validateApiKey(body.key);
    return c.json({ ok: true, data: { valid } });
  } catch (error) {
    console.error('[verify-key]', error instanceof Error ? error.message : error);
    return c.json({
      ok: false,
      error: 'API key validation failed',
    });
  }
});

export { settings };
