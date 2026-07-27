/**
 * CLI agents detection route (v0.5 Task 2 — agent-runtime registry).
 * GET /api/cli-agents — detected + full catalog (≥12 defs)
 * GET /api/cli-agents/catalog — defs only
 */

import { Hono } from 'hono';
import {
  AGENT_CLI_DEFS,
  detectAllAgents,
  detectAvailableAgents,
  settingKeyMap,
  type PathOverrides,
} from '@neos-work/agent-runtime';
import { getSetting } from '../db/settings.js';
// Keep legacy path keys for the original 3 CLIs (settings UI)
import { CLI_PATH_SETTING_KEYS } from '../lib/cli-agents.js';

const cliAgents = new Hono();

function loadPathOverrides(): PathOverrides {
  const overrides: PathOverrides = {};
  const keys = settingKeyMap();
  for (const [id, key] of Object.entries(keys)) {
    const raw = getSetting(key);
    if (typeof raw !== 'string' || !raw || /[\0\r\n]/.test(raw)) continue;
    const v = raw.trim();
    if (v) overrides[id] = v;
  }
  return overrides;
}

cliAgents.get('/catalog', (c) => {
  return c.json({
    ok: true,
    data: AGENT_CLI_DEFS.map((d) => ({
      id: d.id,
      name: d.name,
      family: d.family,
      settingKey: d.settingKey,
      streamFormat: d.streamFormat,
      binary: d.launch.binary,
      enabledByDefault: d.enabledByDefault ?? false,
    })),
    meta: { count: AGENT_CLI_DEFS.length },
  });
});

cliAgents.get('/', async (c) => {
  const overrides = loadPathOverrides();
  const detailed = c.req.query('detailed') === '1' || c.req.query('all') === '1';

  if (detailed) {
    const all = await detectAllAgents(overrides);
    return c.json({
      ok: true,
      data: all,
      meta: {
        pathOverrides: overrides,
        settingKeys: settingKeyMap(),
        legacySettingKeys: CLI_PATH_SETTING_KEYS,
        catalogCount: AGENT_CLI_DEFS.length,
      },
    });
  }

  // Default: available only (backward compatible with desktop Settings)
  const agents = await detectAvailableAgents(overrides);
  return c.json({
    ok: true,
    data: agents,
    meta: {
      pathOverrides: overrides,
      settingKeys: {
        ...CLI_PATH_SETTING_KEYS,
        ...settingKeyMap(),
      },
      catalogCount: AGENT_CLI_DEFS.length,
    },
  });
});

export default cliAgents;
