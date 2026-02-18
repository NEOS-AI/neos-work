import { Hono } from 'hono';

import { ProviderRegistry, AnthropicAdapter, GoogleAdapter } from '@neos-work/core';

import * as settingsDb from '../db/settings.js';

const settings = new Hono();

// GET /api/settings — all settings
settings.get('/', (c) => {
  const all = settingsDb.getAllSettings();
  return c.json({ ok: true, data: all });
});

// GET /api/settings/:key — single setting
settings.get('/:key', (c) => {
  const key = c.req.param('key');
  const value = settingsDb.getSetting(key);
  if (value === undefined) {
    return c.json({ ok: false, error: 'Setting not found' }, 404);
  }
  return c.json({ ok: true, data: { key, value } });
});

// PUT /api/settings/:key — create or update setting
settings.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json<{ value: string }>();
  if (body.value === undefined) {
    return c.json({ ok: false, error: 'Missing "value" in body' }, 400);
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

    const adapter = registry.get(body.provider as 'anthropic' | 'google');
    if (!adapter) {
      return c.json({ ok: false, error: 'Adapter not found' }, 500);
    }

    const valid = await adapter.validateApiKey(body.key);
    return c.json({ ok: true, data: { valid } });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    });
  }
});

export { settings };
