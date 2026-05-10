import { randomBytes } from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { health } from './routes/health.js';
import { session, workspace, models } from './routes/session.js';
import { settings } from './routes/settings.js';
import { skills } from './routes/skills.js';
import { mcp } from './routes/mcp.js';
import workflow from './routes/workflow.js';
import harness from './routes/harness.js';
import blocks from './routes/blocks.js';
import templates from './routes/templates.js';
import { migrateEncryption } from './db/settings.js';
import { registerFinanceBlocks } from '@neos-work/workflow-engine';

// Generate per-session auth token (VULN-002)
const AUTH_TOKEN = randomBytes(32).toString('hex');

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:1420', 'http://localhost:5173', 'tauri://localhost'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Host header validation to prevent DNS rebinding (VULN-007)
// Note: ALLOWED_HOSTS is populated after port is known; middleware reads it dynamically.
const ALLOWED_HOSTS = new Set<string>();

app.use('*', async (c, next) => {
  const host = c.req.header('Host');
  if (host && !ALLOWED_HOSTS.has(host)) {
    return c.json({ ok: false, error: 'Forbidden' }, 403);
  }
  return next();
});

// Authentication middleware (VULN-002)
app.use('*', async (c, next) => {
  // Skip auth for health check (used for connection probing before token is known)
  if (c.req.path === '/api/health') return next();

  const authHeader = c.req.header('Authorization');
  if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }
  return next();
});

// Routes
app.route('/api/health', health);
app.route('/api/workspace', workspace);
app.route('/api/models', models);
app.route('/api/session', session);
app.route('/api/settings', settings);
app.route('/api/skills', skills);
app.route('/api/mcp-servers', mcp);
app.route('/api/workflow', workflow);
app.route('/api/harness', harness);
app.route('/api/blocks', blocks);
app.route('/api/templates', templates);

// Root
app.get('/', (c) => {
  return c.json({
    name: 'NEOS Work Engine',
    version: '0.1.0',
  });
});

// Migrate plaintext API keys to encrypted format
migrateEncryption();

// Register built-in domain blocks
registerFinanceBlocks();

// Start server — use port 0 for OS-assigned random port when PORT is not set (VULN-011)
const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;

const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: requestedPort,
});

// Read actual port and populate allowed hosts
const addr = server.address();
const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;

ALLOWED_HOSTS.add('127.0.0.1');
ALLOWED_HOSTS.add('localhost');
ALLOWED_HOSTS.add(`127.0.0.1:${actualPort}`);
ALLOWED_HOSTS.add(`localhost:${actualPort}`);

// Output structured metadata for Tauri sidecar to parse
console.log(`NEOS_PORT=${actualPort}`);
console.log(`NEOS_AUTH_TOKEN=${AUTH_TOKEN}`);
console.log(`NEOS Work Engine started on http://127.0.0.1:${actualPort}`);

export { app };
