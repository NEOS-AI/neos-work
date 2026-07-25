/**
 * CLI agents detection route.
 * GET /api/cli-agents — returns detected CLI agents on the host (with path overrides).
 */

import { Hono } from 'hono';
import { CLI_PATH_SETTING_KEYS, detectCLIs, type CliPathOverrides } from '../lib/cli-agents.js';
import { getSetting } from '../db/settings.js';

const cliAgents = new Hono();

function loadPathOverrides(): CliPathOverrides {
  const overrides: CliPathOverrides = {};
  for (const [id, key] of Object.entries(CLI_PATH_SETTING_KEYS) as Array<
    [keyof typeof CLI_PATH_SETTING_KEYS, string]
  >) {
    // Control-char check before trim so "\n/bin/claude" is not accepted
    const raw = getSetting(key);
    if (typeof raw !== 'string' || !raw || /[\0\r\n]/.test(raw)) continue;
    const v = raw.trim();
    if (v) overrides[id] = v;
  }
  return overrides;
}

cliAgents.get('/', async (c) => {
  const agents = await detectCLIs(loadPathOverrides());
  return c.json({
    ok: true,
    data: agents,
    meta: {
      pathOverrides: loadPathOverrides(),
      settingKeys: CLI_PATH_SETTING_KEYS,
    },
  });
});

export default cliAgents;
