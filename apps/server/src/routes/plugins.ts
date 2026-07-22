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

const plugins = new Hono();

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

  const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : undefined;
  let skillDirName =
    typeof body.skillDirName === 'string' ? body.skillDirName.trim() || undefined : undefined;
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

  const name = typeof body.name === 'string' ? body.name.trim() || undefined : undefined;
  const description =
    typeof body.description === 'string' ? body.description.trim() || undefined : undefined;

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
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const plugin = await getPlugin(id);
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);
  const { dir: _, ...p } = plugin;
  return c.json({ ok: true, data: p });
});

plugins.post('/:id/run', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const plugin = await getPlugin(id);
  if (!plugin) return c.json({ ok: false, error: 'Not found' }, 404);

  let inputs: Record<string, unknown> = {};
  try {
    const body = await c.req.json<{ inputs?: Record<string, unknown> }>();
    if (body.inputs) inputs = body.inputs;
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
  const body = await c.req.json<{ stageId: string; response: Record<string, unknown> }>().catch(
    () => null,
  );
  const stageId = typeof body?.stageId === 'string' ? body.stageId.trim() : '';
  if (!stageId) return c.json({ ok: false, error: 'stageId required' }, 400);
  const runId = c.req.param('runId').trim();
  if (!runId) return c.json({ ok: false, error: 'Run not found or stage mismatch' }, 404);
  const ok = resumeRun(runId, stageId, body?.response ?? {});
  if (!ok) return c.json({ ok: false, error: 'Run not found or stage mismatch' }, 404);
  return c.json({ ok: true });
});

export default plugins;
