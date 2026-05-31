/**
 * CLI agents detection route.
 * GET /api/cli-agents — returns detected CLI agents on the host.
 */

import { Hono } from 'hono';
import { detectCLIs } from '../lib/cli-agents.js';

const cliAgents = new Hono();

cliAgents.get('/', async (c) => {
  const agents = await detectCLIs();
  return c.json({ ok: true, data: agents });
});

export default cliAgents;
