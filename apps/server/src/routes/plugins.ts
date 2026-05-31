/**
 * Plugin routes
 * GET  /api/plugins           — list plugins
 * GET  /api/plugins/:id       — get plugin detail
 * POST /api/plugins/:id/run   — run pipeline (SSE)
 * POST /api/plugins/:id/run/:runId/resume — resume waiting stage
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { listPlugins, getPlugin } from '../lib/plugin-store.js';
import { runPlugin, resumeRun } from '../lib/plugin-runner.js';
import type { PluginSSEEvent } from '../lib/plugin-runner.js';
import { getWorkflowSecrets } from '../db/settings.js';

const plugins = new Hono();

plugins.get('/', async (c) => {
  const list = await listPlugins();
  // Strip skillContent and dir for list view
  return c.json({ ok: true, data: list.map(({ skillContent: _, dir: __, ...p }) => p) });
});

plugins.get('/:id', async (c) => {
  const plugin = await getPlugin(c.req.param('id'));
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);
  const { dir: _, ...p } = plugin;
  return c.json({ ok: true, data: p });
});

plugins.post('/:id/run', async (c) => {
  const plugin = await getPlugin(c.req.param('id'));
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);

  let inputs: Record<string, unknown> = {};
  try {
    const body = await c.req.json<{ inputs?: Record<string, unknown> }>();
    if (body.inputs) inputs = body.inputs;
  } catch {
    // No body
  }

  const settings = getWorkflowSecrets();
  const controller = new AbortController();

  return stream(c, async (writableStream) => {
    const sendEvent = async (event: PluginSSEEvent) => {
      await writableStream.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    c.req.raw.signal.addEventListener('abort', () => controller.abort());
    await runPlugin({ plugin, inputs, settings, onEvent: sendEvent, signal: controller.signal });
  });
});

plugins.post('/:id/run/:runId/resume', async (c) => {
  const body = await c.req.json<{ stageId: string; response: Record<string, unknown> }>();
  if (!body.stageId) return c.json({ ok: false, error: 'stageId required' }, 400);
  const ok = resumeRun(c.req.param('runId'), body.stageId, body.response ?? {});
  if (!ok) return c.json({ ok: false, error: 'Run not found or stage mismatch' }, 404);
  return c.json({ ok: true });
});

export default plugins;
