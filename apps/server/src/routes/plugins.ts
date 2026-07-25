/**
 * Plugin routes
 * GET  /api/plugins           — list plugins
 * GET  /api/plugins/:id       — get plugin detail
 * POST /api/plugins/:id/run   — run pipeline (SSE)
 * POST /api/plugins/:id/run/:runId/resume — resume waiting stage
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { listPlugins, getPlugin, upgradeSkillToPlugin } from '../lib/plugin-store.js';
import { runPlugin, resumeRun } from '../lib/plugin-runner.js';
import type { PluginSSEEvent } from '../lib/plugin-runner.js';
import { getExecutionSettings } from '../db/settings.js';
import { getDb } from '../db/schema.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from '../lib/runtime-context.js';
import { safeRouteId } from '../lib/path-safety.js';

const plugins = new Hono();

function paramId(c: { req: { param: (k: string) => string } }, key = 'id'): string {
  return safeRouteId(c.req.param(key));
}

plugins.get('/', async (c) => {
  const list = await listPlugins();
  // Strip skillContent and dir for list view
  return c.json({ ok: true, data: list.map(({ skillContent: _, dir: __, ...p }) => p) });
});

/**
 * Upgrade a skill to a plugin (writes open-design.json next to SKILL.md).
 * Body: { skillId?: string, skillDirName?: string, name?: string, description?: string }
 */
plugins.post('/upgrade-from-skill', async (c) => {
  type UpgradeBody = {
    skillId?: string;
    skillDirName?: string;
    name?: string;
    description?: string;
  };
  const body: UpgradeBody = await c.req.json<UpgradeBody>().catch(() => ({}));

  let skillId: string | undefined;
  if (typeof body.skillId === 'string') {
    // Control-char check before trim
    if (/[\0\r\n]/.test(body.skillId) || body.skillId.trim().length > 100) {
      return c.json({ ok: false, error: 'Invalid skillId' }, 400);
    }
    skillId = body.skillId.trim() || undefined;
  }
  let skillDirName: string | undefined;
  if (typeof body.skillDirName === 'string') {
    if (
      /[\0\r\n]/.test(body.skillDirName)
      || body.skillDirName.includes('/')
      || body.skillDirName.includes('\\')
      || body.skillDirName.trim().length > 200
    ) {
      return c.json({ ok: false, error: 'Invalid skillDirName' }, 400);
    }
    skillDirName = body.skillDirName.trim() || undefined;
  }
  if (!skillDirName && skillId) {
    const row = getDb().prepare('SELECT path, name FROM skill WHERE id = ?').get(skillId) as
      | { path: string; name: string }
      | undefined;
    if (!row) return c.json({ ok: false, error: 'Skill not found' }, 404);
    // path is .../skills/<dir>/SKILL.md or the skill file path
    const parts = row.path.replace(/\\/g, '/').split('/');
    const skillsIdx = parts.lastIndexOf('skills');
    skillDirName = skillsIdx >= 0 && parts[skillsIdx + 1] ? parts[skillsIdx + 1] : row.name;
  }
  if (!skillDirName) {
    return c.json({ ok: false, error: 'skillId or skillDirName required' }, 400);
  }

  let name: string | undefined;
  if (typeof body.name === 'string') {
    if (/[\0\r\n]/.test(body.name) || body.name.trim().length > 200) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    name = body.name.trim() || undefined;
  }
  let description: string | undefined;
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    description = body.description.trim() || undefined;
    if (description && description.length > 2_000) {
      description = description.slice(0, 2_000);
    }
  }

  try {
    const plugin = await upgradeSkillToPlugin({
      skillDirName,
      name,
      description,
    });
    const { dir: _, skillContent: __, ...safe } = plugin;
    return c.json({ ok: true, data: safe }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upgrade failed';
    return c.json({ ok: false, error: msg }, 400);
  }
});

plugins.get('/:id', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const plugin = await getPlugin(id);
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);
  const { dir: _, ...p } = plugin;
  return c.json({ ok: true, data: p });
});

plugins.post('/:id/run', async (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const plugin = await getPlugin(id);
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);

  let inputs: Record<string, unknown> = {};
  try {
    const body = await c.req.json<{ inputs?: Record<string, unknown> }>();
    // Only plain objects (not arrays) as plugin inputs
    if (
      body.inputs
      && typeof body.inputs === 'object'
      && !Array.isArray(body.inputs)
    ) {
      const serialized = JSON.stringify(body.inputs);
      // Cap inputs payload (plan Task 5)
      if (serialized.length > 256_000) {
        return c.json({ ok: false, error: 'inputs payload too large' }, 400);
      }
      inputs = body.inputs;
    }
  } catch {
    // No body
  }

  const settings = getExecutionSettings({
    serverUrl: getRuntimeServerUrl(),
    authToken: getRuntimeAuthToken(),
  });
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
  const pluginId = paramId(c);
  if (!pluginId) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ stageId: string; response: Record<string, unknown> }>().catch(
    () => null,
  );
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const stageId = typeof body.stageId === 'string' ? body.stageId.trim() : '';
  if (!stageId || stageId.length > 100 || /[\0\r\n]/.test(stageId)) {
    return c.json({ ok: false, error: 'stageId required' }, 400);
  }
  const runId = paramId(c, 'runId');
  if (!runId) {
    return c.json({ ok: false, error: 'Run not found or stage mismatch' }, 404);
  }
  // Ensure plugin still exists before resuming (id is part of the public path)
  const plugin = await getPlugin(pluginId);
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);
  const response =
    body.response && typeof body.response === 'object' && !Array.isArray(body.response)
      ? body.response
      : {};
  // Cap HITL response payload
  if (JSON.stringify(response).length > 200_000) {
    return c.json({ ok: false, error: 'response payload too large' }, 400);
  }
  const ok = resumeRun(runId, stageId, response);
  if (!ok) return c.json({ ok: false, error: 'Run not found or stage mismatch' }, 404);
  return c.json({ ok: true });
});

export default plugins;
