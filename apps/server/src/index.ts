import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
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
import workers from './routes/workers.js';
import domainPacks from './routes/domain-packs.js';
import blocks from './routes/blocks.js';
import templates from './routes/templates.js';
import memory from './routes/memory.js';
import webhooks from './routes/webhooks.js';
import designSystems from './routes/design-systems.js';
import artifacts from './routes/artifacts.js';
import workflowRevisions from './routes/workflow-revisions.js';
import cliAgents from './routes/cli-agents.js';
import routines from './routes/routines.js';
import media from './routes/media.js';
import deploy from './routes/deploy.js';
import pluginsRoute from './routes/plugins.js';
import projects from './routes/projects.js';
import runs from './routes/runs.js';
import liveArtifacts from './routes/live-artifacts.js';
import toolsLiveArtifacts from './routes/tools-live-artifacts.js';
import connectionTest from './routes/connection-test.js';
import { migrateEncryption } from './db/settings.js';
import { resolveWebDist } from './lib/web-static.js';
import { loadInstalledDomainPacks } from './lib/domain-pack-store.js';
import { registerCodingBlocks, registerFinanceBlocks, registerWorker } from '@neos-work/workflow-engine';
import { listCustomWorkers } from './db/workers.js';
import { initScheduler } from './lib/routine-scheduler.js';
import { setRuntimeContext } from './lib/runtime-context.js';

/**
 * Auth token: fixed via NEOS_AUTH_TOKEN (Docker / stable CLI) or random per process.
 * Min 16 chars when provided from env.
 */
function resolveAuthToken(): string {
  const raw = process.env.NEOS_AUTH_TOKEN;
  if (typeof raw === 'string' && !/[\0\r\n]/.test(raw)) {
    const t = raw.trim();
    if (t.length >= 16 && t.length <= 8_192) return t;
  }
  return randomBytes(32).toString('hex');
}

const AUTH_TOKEN = resolveAuthToken();
// Seed early so CLI spawn during startup paths has a token; port updated after listen
setRuntimeContext({ authToken: AUTH_TOKEN, port: parseInt(process.env.NEOS_PORT ?? process.env.PORT ?? '3000', 10) });

const app = new Hono();

// Middleware
app.use('*', logger());

const CORS_ORIGINS = (() => {
  const extra = process.env.NEOS_CORS_ORIGINS;
  const base = ['http://localhost:1420', 'http://localhost:5173', 'tauri://localhost'];
  if (typeof extra === 'string' && !/[\0\r\n]/.test(extra)) {
    for (const o of extra.split(',')) {
      const t = o.trim();
      if (t && (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('tauri://'))) {
        base.push(t);
      }
    }
  }
  return base;
})();

app.use(
  '*',
  cors({
    origin: CORS_ORIGINS,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Host header validation to prevent DNS rebinding (VULN-007)
// Note: ALLOWED_HOSTS is populated after port is known; middleware reads it dynamically.
// Docker/self-host: NEOS_ALLOW_ANY_HOST=1 or NEOS_ALLOWED_HOSTS=host1,host2:port
const ALLOWED_HOSTS = new Set<string>();
const ALLOW_ANY_HOST =
  process.env.NEOS_ALLOW_ANY_HOST === '1'
  || process.env.NEOS_ALLOW_ANY_HOST === 'true';

app.use('*', async (c, next) => {
  if (ALLOW_ANY_HOST) return next();
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

  // Webhook endpoint uses HMAC-SHA256 signature auth — skip Bearer token check
  if (c.req.path.startsWith('/api/webhook/')) return next();

  // Tool-token routes validate agent tool tokens themselves (Task 9)
  if (c.req.path.startsWith('/api/tools/')) return next();

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
app.route('/api/workers', workers);
app.route('/api/domain-packs', domainPacks);
app.route('/api/harness', harness);
app.route('/api/harnesses', harness); // v0.4 deprecation alias
app.route('/api/blocks', blocks);
app.route('/api/templates', templates);
app.route('/api/memory', memory);
app.route('/api/webhook', webhooks);
app.route('/api/design-systems', designSystems);
app.route('/api/artifacts', artifacts);
app.route('/api/workflow-revisions', workflowRevisions);
app.route('/api/cli-agents', cliAgents);
app.route('/api/routines', routines);
app.route('/api/media', media);
app.route('/api/deploy', deploy);
app.route('/api/plugins', pluginsRoute);
app.route('/api/projects', projects);
app.route('/api/runs', runs);
app.route('/api/live-artifacts', liveArtifacts);
app.route('/api/tools/live-artifacts', toolsLiveArtifacts);
app.route('/api/connection-test', connectionTest);

/** API banner (always JSON). SPA may own `/` when NEOS_WEB_DIST is set. */
app.get('/api', (c) => {
  return c.json({
    name: 'NEOS Work Engine',
    version: '0.5.22',
  });
});

/** Optional static web client (Task 12). See resolveWebDist / NEOS_WEB_DIST. */
const webDist = resolveWebDist();
if (webDist) {
  // Serve assets; SPA fallback for client routes
  app.use(
    '/*',
    serveStatic({
      root: webDist,
      rewriteRequestPath: (p) => (p === '/' ? '/index.html' : p),
    }),
  );
  app.get('*', async (c) => {
    // Only HTML fallback for non-file navigations
    const indexPath = path.join(webDist, 'index.html');
    try {
      const html = fs.readFileSync(indexPath, 'utf8');
      return c.html(html);
    } catch {
      return c.json({ ok: false, error: 'Web UI index missing' }, 404);
    }
  });
  console.log(`NEOS_WEB_DIST=${webDist}`);
} else {
  app.get('/', (c) => {
    return c.json({
      name: 'NEOS Work Engine',
      version: '0.5.22',
      hint: 'Build apps/web and set NEOS_WEB_DIST to serve the browser UI',
    });
  });
}

// Migrate plaintext API keys to encrypted format
migrateEncryption();

// Register built-in domain blocks
registerFinanceBlocks();
// Hydrate custom workers from SQLite into runtime registry
for (const w of listCustomWorkers()) {
  registerWorker(w);
}
registerCodingBlocks();

// Load custom Domain Packs from data dir (Task 15)
void loadInstalledDomainPacks().then((r) => {
  if (r.loaded > 0) {
    console.log(`Domain packs loaded: ${r.loaded}`);
  }
  if (r.errors.length > 0) {
    console.warn(`Domain pack load errors: ${r.errors.join('; ')}`);
  }
});

// Initialize automation routine scheduler
initScheduler();

// Start server — NEOS_HOST (default 127.0.0.1; Docker: 0.0.0.0), NEOS_PORT/PORT
const requestedPort = parseInt(process.env.NEOS_PORT ?? process.env.PORT ?? '3000', 10);
const listenHostRaw = process.env.NEOS_HOST;
const listenHost =
  typeof listenHostRaw === 'string'
  && !/[\0\r\n]/.test(listenHostRaw)
  && listenHostRaw.trim()
    ? listenHostRaw.trim()
    : '127.0.0.1';

const server = serve({
  fetch: app.fetch,
  hostname: listenHost,
  port: requestedPort,
});

// Read actual port and populate allowed hosts
const addr = server.address();
const actualPort = typeof addr === 'object' && addr && addr.port ? addr.port : requestedPort;

ALLOWED_HOSTS.add('127.0.0.1');
ALLOWED_HOSTS.add('localhost');
ALLOWED_HOSTS.add(`127.0.0.1:${actualPort}`);
ALLOWED_HOSTS.add(`localhost:${actualPort}`);
if (listenHost !== '127.0.0.1' && listenHost !== '0.0.0.0') {
  ALLOWED_HOSTS.add(listenHost);
  ALLOWED_HOSTS.add(`${listenHost}:${actualPort}`);
}
// Extra hosts for reverse proxies / Docker published ports
const extraHosts = process.env.NEOS_ALLOWED_HOSTS;
if (typeof extraHosts === 'string' && !/[\0\r\n]/.test(extraHosts)) {
  for (const h of extraHosts.split(',')) {
    const t = h.trim();
    if (t) ALLOWED_HOSTS.add(t);
  }
}

setRuntimeContext({ authToken: AUTH_TOKEN, port: actualPort });

// Output structured metadata for Tauri sidecar / CLI / Docker logs
console.log(`NEOS_PORT=${actualPort}`);
console.log(`NEOS_HOST=${listenHost}`);
console.log(`NEOS_AUTH_TOKEN=${AUTH_TOKEN}`);
if (process.env.NEOS_DATA_DIR) {
  console.log(`NEOS_DATA_DIR=${process.env.NEOS_DATA_DIR}`);
}
console.log(`NEOS Work Engine started on http://${listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost}:${actualPort}`);

export { app, AUTH_TOKEN, resolveAuthToken };
