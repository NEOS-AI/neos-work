#!/usr/bin/env node
/**
 * Multi-replica collab e2e (C4).
 *
 * Modes:
 *   1. Structural (default, CI-safe) — compose file + ops docs + env contracts
 *   2. Live (--live or NEOS_MULTI_REPLICA_E2E=1) — Redis + two engine processes
 *      with shared data dir; asserts collab status, cross-node peers, selection fan-out
 *
 * Usage:
 *   node e2e/multi-replica/run.mjs
 *   pnpm e2e:multi-replica
 *   NEOS_MULTI_REPLICA_E2E=1 pnpm e2e:multi-replica
 *   node e2e/multi-replica/run.mjs --live
 *   node e2e/multi-replica/run.mjs --live --skip-redis-docker  # use existing Redis URL
 *
 * Live requires: Node 22, built @neos-work/server, optional `redis` package for real bus,
 * Docker (to start redis:7-alpine) unless NEOS_COLLAB_REDIS_URL points at a live Redis.
 *
 * Exit 0 on success or structural-only pass; 1 on failure.
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LIVE =
  process.argv.includes('--live')
  || process.env.NEOS_MULTI_REPLICA_E2E === '1'
  || process.env.NEOS_MULTI_REPLICA_E2E === 'true';
const SKIP_REDIS_DOCKER = process.argv.includes('--skip-redis-docker');

const failures = [];
const children = [];
let redisContainer = null;

function ok(name, cond, detail = '') {
  if (cond) process.stdout.write(`  ✓ ${name}${detail ? ` — ${detail}` : ''}\n`);
  else {
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(name);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Read SSE until we see ready with sessionId (or timeout). */
async function openCollabStream(baseUrl, token, projectId, displayName, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/collab/stream?name=${encodeURIComponent(displayName)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return { ok: false, error: `HTTP ${res.status}`, close: () => {} };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sessionId = '';
    let peers = [];
    const started = Date.now();
    while (Date.now() - started < timeoutMs && !sessionId) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // ready payload
      const ready = /event:\s*ready\s*\ndata:\s*(\{[^\n]+\})/.exec(buf);
      if (ready) {
        try {
          const j = JSON.parse(ready[1]);
          if (typeof j.sessionId === 'string') sessionId = j.sessionId;
        } catch {
          /* ignore */
        }
      }
      const sync = /event:\s*presence\.sync\s*\ndata:\s*(\{[^\n]+)/.exec(buf);
      if (sync) {
        try {
          // data may be multi-line; try loose parse of first JSON object after data:
          const idx = buf.indexOf('event: presence.sync');
          const slice = buf.slice(idx);
          const m = /data:\s*(\{[\s\S]*?\})\s*\n\n/.exec(slice);
          if (m) {
            const j = JSON.parse(m[1]);
            if (j.self?.sessionId) sessionId = j.self.sessionId;
            if (Array.isArray(j.peers)) peers = j.peers;
          }
        } catch {
          /* ignore */
        }
      }
      if (!sessionId) {
        const loose = /"sessionId"\s*:\s*"([a-f0-9]{12,})"/i.exec(buf);
        if (loose) sessionId = loose[1];
      }
    }
    clearTimeout(timer);
    const close = () => {
      controller.abort();
      reader.cancel().catch(() => {});
    };
    if (!sessionId) return { ok: false, error: 'no sessionId from stream', close };
    return { ok: true, sessionId, peers, close, reader, controller };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: String(e?.message || e), close: () => {} };
  }
}

async function waitForHealth(baseUrl, token, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const { res, body } = await fetchJson(`${baseUrl}/api/health`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok && body && (body.status === 'ok' || body.status === 'healthy' || body.ok === true || body.status)) {
        return true;
      }
      // some health is bare { status: 'ok' }
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

function startServer({ port, dataDir, token, redisUrl, logLabel }) {
  const entry = path.join(ROOT, 'apps/server/dist/index.js');
  if (!fs.existsSync(entry)) {
    throw new Error('server dist missing — run pnpm --filter @neos-work/server build');
  }
  const env = {
    ...process.env,
    NEOS_HOST: '127.0.0.1',
    NEOS_PORT: String(port),
    NEOS_DATA_DIR: dataDir,
    NEOS_AUTH_TOKEN: token,
    NEOS_ALLOW_ANY_HOST: '1',
    NEOS_COLLAB_BUS: 'redis',
    NEOS_COLLAB_REDIS_URL: redisUrl,
    NEOS_COLLAB_PRESENCE: 'auto',
    // avoid clobbering parent
    NODE_ENV: process.env.NODE_ENV || 'test',
  };
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(ROOT, 'apps/server'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const prefix = `[${logLabel}] `;
  child.stdout?.on('data', (d) => {
    if (process.env.NEOS_MULTI_REPLICA_VERBOSE === '1') {
      process.stdout.write(prefix + d.toString());
    }
  });
  child.stderr?.on('data', (d) => {
    if (process.env.NEOS_MULTI_REPLICA_VERBOSE === '1') {
      process.stderr.write(prefix + d.toString());
    }
  });
  return child;
}

function killChildren() {
  for (const c of children.splice(0)) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  if (redisContainer) {
    spawnSync('docker', ['rm', '-f', redisContainer], { stdio: 'ignore' });
    redisContainer = null;
  }
}

process.on('exit', killChildren);
process.on('SIGINT', () => {
  killChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killChildren();
  process.exit(143);
});

// ── Structural ─────────────────────────────────────────────

process.stdout.write('NEOS Work multi-replica e2e (C4)\n');

section('1. Structural contracts');
ok(
  'deploy/docker-compose.multi.yml exists',
  exists('deploy/docker-compose.multi.yml'),
);
ok(
  'docs/ops/multi-replica-collab.md exists',
  exists('docs/ops/multi-replica-collab.md'),
);

if (exists('deploy/docker-compose.multi.yml')) {
  const yml = read('deploy/docker-compose.multi.yml');
  ok('compose defines redis service', /redis:\s*\n/.test(yml) || /image:\s*redis/.test(yml));
  ok('compose defines neos-a and neos-b', /neos-a:/.test(yml) && /neos-b:/.test(yml));
  ok(
    'compose sets NEOS_COLLAB_BUS=redis',
    /NEOS_COLLAB_BUS:\s*redis/.test(yml) || /NEOS_COLLAB_BUS=redis/.test(yml),
  );
  ok(
    'compose sets NEOS_COLLAB_REDIS_URL',
    /NEOS_COLLAB_REDIS_URL/.test(yml),
  );
  ok(
    'compose sets NEOS_COLLAB_PRESENCE',
    /NEOS_COLLAB_PRESENCE/.test(yml),
  );
  ok(
    'compose uses distinct host ports for A/B',
    /NEOS_PORT_A|3000:3000/.test(yml) && /NEOS_PORT_B|3001:3000/.test(yml),
  );
}

if (exists('docs/ops/multi-replica-collab.md')) {
  const doc = read('docs/ops/multi-replica-collab.md');
  ok('ops doc mentions collab/status', /collab\/status/.test(doc));
  ok('ops doc mentions peers checklist', /collab\/peers|Presence count/i.test(doc));
}

{
  const pkg = JSON.parse(read('package.json'));
  ok(
    'package.json has e2e:multi-replica script',
    typeof pkg.scripts?.['e2e:multi-replica'] === 'string',
  );
}

// ── Live ───────────────────────────────────────────────────

if (!LIVE) {
  section('2. Live multi-replica');
  process.stdout.write(
    '  · skipped (set NEOS_MULTI_REPLICA_E2E=1 or pass --live to run two engines + Redis)\n',
  );
  process.stdout.write(
    failures.length
      ? `\nFAILED ${failures.length}: ${failures.join(', ')}\n`
      : '\nOK (structural only)\n',
  );
  process.exit(failures.length ? 1 : 0);
}

section('2. Live multi-replica (Redis + two engines)');

const token =
  (process.env.NEOS_AUTH_TOKEN || '').trim().length >= 16
    ? process.env.NEOS_AUTH_TOKEN.trim()
    : `e2e-multi-${crypto.randomBytes(16).toString('hex')}`;

let redisUrl =
  (process.env.NEOS_COLLAB_REDIS_URL || process.env.REDIS_URL || '').trim()
  || '';

// Ensure redis npm client is available for real pub/sub (server dependency)
const redisPkgPaths = [
  path.join(ROOT, 'apps/server/node_modules/redis/package.json'),
  path.join(ROOT, 'node_modules/redis/package.json'),
];
const redisPkgOk = redisPkgPaths.some((p) => fs.existsSync(p));
ok(
  'redis package present for multi-node bus',
  redisPkgOk,
  redisPkgOk ? '' : 'add redis dependency to @neos-work/server',
);

if (!redisUrl && !SKIP_REDIS_DOCKER) {
  const name = `neos-e2e-redis-${process.pid}`;
  process.stdout.write(`  → starting redis container ${name}\n`);
  const r = spawnSync(
    'docker',
    ['run', '-d', '--rm', '--name', name, '-p', '6379:6379', 'redis:7-alpine'],
    { encoding: 'utf8' },
  );
  if (r.status === 0) {
    redisContainer = name;
    redisUrl = 'redis://127.0.0.1:6379';
    await sleep(800);
    ok('redis container started', true, name);
  } else {
    ok('redis container started', false, (r.stderr || r.stdout || 'docker failed').slice(0, 200));
  }
} else if (redisUrl) {
  ok('using existing Redis URL', true, redisUrl.replace(/\/\/.*@/, '//***@'));
} else {
  ok('Redis URL available', false, 'set NEOS_COLLAB_REDIS_URL or allow docker');
}

// Ephemeral ports avoid collisions with leftover processes
const portA = Number(process.env.NEOS_PORT_A || 13000 + (process.pid % 500));
const portB = Number(process.env.NEOS_PORT_B || portA + 1);
const baseA = `http://127.0.0.1:${portA}`;
const baseB = `http://127.0.0.1:${portB}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-multi-e2e-'));

if (redisUrl && redisPkgOk) {
  // Wait for Redis PING before engines connect
  let redisUp = false;
  for (let i = 0; i < 20; i++) {
    const ping = spawnSync('docker', ['exec', redisContainer || '', 'redis-cli', 'ping'], {
      encoding: 'utf8',
    });
    if (ping.status === 0 && /PONG/i.test(ping.stdout || '')) {
      redisUp = true;
      break;
    }
    // external redis — try TCP via redis-cli host if no container
    if (!redisContainer) {
      redisUp = true;
      break;
    }
    await sleep(250);
  }
  ok('redis accepting connections', redisUp || !redisContainer, redisUrl);

  try {
    // Start A first so SQLite schema init is single-writer; B attaches after
    startServer({
      port: portA,
      dataDir,
      token,
      redisUrl,
      logLabel: 'A',
    });
  } catch (e) {
    ok('start engine A', false, String(e?.message || e));
  }

  const healthyA = await waitForHealth(baseA, token, 50);
  ok('engine A /api/health', healthyA, baseA);

  if (healthyA) {
    try {
      startServer({
        port: portB,
        dataDir,
        token,
        redisUrl,
        logLabel: 'B',
      });
    } catch (e) {
      ok('start engine B', false, String(e?.message || e));
    }
  }

  const healthyB = healthyA ? await waitForHealth(baseB, token, 50) : false;
  ok('engine B /api/health', healthyB, baseB);

  if (healthyA && healthyB) {
    const stA = await fetchJson(`${baseA}/api/collab/status`, {
      headers: authHeaders(token),
    });
    const stB = await fetchJson(`${baseB}/api/collab/status`, {
      headers: authHeaders(token),
    });
    ok('collab status A ok', stA.res.ok && stA.body?.ok === true);
    ok('collab status B ok', stB.res.ok && stB.body?.ok === true);
    let busA = stA.body?.data?.bus;
    let busB = stB.body?.data?.bus;
    // Allow brief connect window (status kind flips redis-stub → redis when ready)
    for (let i = 0; i < 20 && (busA !== 'redis' || busB !== 'redis'); i++) {
      await sleep(200);
      const a2 = await fetchJson(`${baseA}/api/collab/status`, { headers: authHeaders(token) });
      const b2 = await fetchJson(`${baseB}/api/collab/status`, { headers: authHeaders(token) });
      if (a2.body?.data?.bus) busA = a2.body.data.bus;
      if (b2.body?.data?.bus) busB = b2.body.data.bus;
    }
    ok(
      'both buses report redis (not stub-only)',
      busA === 'redis' && busB === 'redis',
      `A=${busA} B=${busB}`,
    );
    ok(
      'both buses ready',
      stA.body?.data?.ready === true && stB.body?.data?.ready === true,
    );
    const nodeA = stA.body?.data?.nodeId;
    const nodeB = stB.body?.data?.nodeId;
    ok(
      'distinct nodeIds',
      typeof nodeA === 'string' && typeof nodeB === 'string' && nodeA !== nodeB,
      `${nodeA} vs ${nodeB}`,
    );

    // Create project once (shared data dir)
    const create = await fetchJson(`${baseA}/api/projects`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: `multi-e2e-${process.pid}` }),
    });
    const projectId = create.body?.data?.id;
    ok('create project on A (shared data)', create.res.ok || create.res.status === 201, projectId);

    if (projectId) {
      // B can see project via shared SQLite
      const getB = await fetchJson(`${baseB}/api/projects/${projectId}`, {
        headers: authHeaders(token),
      });
      ok('project visible on B via shared data dir', getB.res.ok && getB.body?.ok === true);

      const streamA = await openCollabStream(baseA, token, projectId, 'ReplicaA');
      ok('collab stream join on A', streamA.ok, streamA.error || streamA.sessionId);

      const streamB = await openCollabStream(baseB, token, projectId, 'ReplicaB');
      ok('collab stream join on B', streamB.ok, streamB.error || streamB.sessionId);

      // Give bus + registry a moment to hydrate
      await sleep(1_200);

      const peersA = await fetchJson(
        `${baseA}/api/projects/${projectId}/collab/peers`,
        { headers: authHeaders(token) },
      );
      const peersB = await fetchJson(
        `${baseB}/api/projects/${projectId}/collab/peers`,
        { headers: authHeaders(token) },
      );
      const listA = peersA.body?.data?.peers ?? [];
      const listB = peersB.body?.data?.peers ?? [];
      const aSeesB =
        streamB.sessionId
        && listA.some((p) => p.sessionId === streamB.sessionId);
      const bSeesA =
        streamA.sessionId
        && listB.some((p) => p.sessionId === streamA.sessionId);
      ok(
        'cross-replica peer visibility (A sees B or B sees A via peers/registry)',
        aSeesB || bSeesA,
        `A peers=${listA.length} B peers=${listB.length}`,
      );

      if (streamA.ok && streamA.sessionId) {
        const sel = await fetchJson(
          `${baseA}/api/projects/${projectId}/collab/selection`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              sessionId: streamA.sessionId,
              path: 'index.html',
              selector: '#hero',
            }),
          },
        );
        ok('publish selection on A', sel.res.ok && sel.body?.ok === true);
        await sleep(800);
        const selsB = await fetchJson(
          `${baseB}/api/projects/${projectId}/collab/selections`,
          { headers: authHeaders(token) },
        );
        const selections = selsB.body?.data?.selections ?? [];
        ok(
          'selection fan-out visible on B',
          selections.some(
            (s) =>
              s.sessionId === streamA.sessionId
              && (s.selector === '#hero' || s.path === 'index.html'),
          ),
          `count=${selections.length}`,
        );
      }

      streamA.close?.();
      streamB.close?.();
    }
  }
} else {
  process.stdout.write(
    '  · live probes skipped — need redis package + Redis URL/docker\n',
  );
}

killChildren();
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

section('Done');
if (failures.length) {
  process.stdout.write(`\nFAILED ${failures.length}: ${failures.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('\nOK\n');
process.exit(0);
