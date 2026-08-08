#!/usr/bin/env node
/**
 * Process API golden path (v0.14 M1 / PLAN_FOR_V0_14_0).
 *
 * Boots a real built server (`apps/server/dist/index.js`) with ephemeral data dir
 * and Bearer auth, then exercises the Design Project HTTP path that clients depend on.
 *
 * This is **T2 process E2E** — not browser UI, not in-process Hono (see e2e:contract).
 *
 * Usage:
 *   pnpm e2e:journey
 *   node e2e/journey/run.mjs
 *
 * Requires: Node.js 22+, built server dist (+ workspace package dist via turbo).
 * CI: `.github/workflows/ci.yml` builds `@neos-work/server...` then runs this.
 *
 * Exit 0 on success, 1 on failure.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const failures = [];
let child = null;
let dataDir = null;

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

function failFast(msg) {
  process.stderr.write(`e2e:journey: ${msg}\n`);
  process.exit(1);
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
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function cleanup() {
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    child = null;
  }
  if (dataDir) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    dataDir = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

// ── Preconditions ──────────────────────────────────────────

section('0. Preconditions');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  failFast(
    `Node.js 22+ required (got v${process.versions.node}). `
      + 'better-sqlite3 native modules are built for engines.node >= 22. '
      + 'Use nvm/fnm to switch, then reinstall deps if needed.',
  );
}
ok('Node.js major >= 22', true, `v${process.versions.node}`);

const entry = path.join(ROOT, 'apps/server/dist/index.js');
if (!fs.existsSync(entry)) {
  failFast(
    'server dist missing — run:\n'
      + '  pnpm --filter @neos-work/server... build\n'
      + 'or: pnpm turbo build --filter=@neos-work/server',
  );
}
ok('server dist present', true, 'apps/server/dist/index.js');

// ── Boot server ────────────────────────────────────────────

section('1. Boot engine process');

const token = `journey-${crypto.randomBytes(16).toString('hex')}`;
const port = Number(process.env.NEOS_JOURNEY_PORT || 14000 + (process.pid % 500));
const base = `http://127.0.0.1:${port}`;
dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-journey-'));

const env = {
  ...process.env,
  NEOS_HOST: '127.0.0.1',
  NEOS_PORT: String(port),
  NEOS_DATA_DIR: dataDir,
  NEOS_AUTH_TOKEN: token,
  NEOS_ALLOW_ANY_HOST: '1',
  // Hard-enforce for user lock path (journey case 7)
  NEOS_SHARED_EDIT: '1',
  // Keep agents flag off for user-only 423 case; contract covers agent wire
  NEOS_SHARED_EDIT_AGENTS: process.env.NEOS_SHARED_EDIT_AGENTS || '0',
  NODE_ENV: process.env.NODE_ENV || 'test',
};

child = spawn(process.execPath, [entry], {
  cwd: path.join(ROOT, 'apps/server'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let bootLog = '';
child.stdout?.on('data', (d) => {
  bootLog += d.toString();
  if (process.env.NEOS_JOURNEY_VERBOSE === '1') {
    process.stdout.write(`[server] ${d}`);
  }
});
child.stderr?.on('data', (d) => {
  bootLog += d.toString();
  if (process.env.NEOS_JOURNEY_VERBOSE === '1') {
    process.stderr.write(`[server] ${d}`);
  }
});

child.on('exit', (code, signal) => {
  if (failures.length === 0 && code && code !== 0) {
    process.stderr.write(
      `e2e:journey: server exited early code=${code} signal=${signal}\n${bootLog.slice(-2000)}\n`,
    );
  }
});

async function waitForHealth(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (child?.exitCode != null) return false;
    try {
      const { res } = await fetchJson(`${base}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

const healthy = await waitForHealth();
ok('engine /api/health', healthy, base);
if (!healthy) {
  process.stderr.write(`boot log (tail):\n${bootLog.slice(-3000)}\n`);
  process.stdout.write(`\nFAILED ${failures.length}: ${failures.join(', ')}\n`);
  cleanup();
  process.exit(1);
}

// Unauthorized wall
{
  const unauth = await fetchJson(`${base}/api/projects`);
  ok(
    'Bearer required on /api/projects',
    unauth.res.status === 401,
    `status=${unauth.res.status}`,
  );
}

// ── Golden path ────────────────────────────────────────────

section('2. Design Project create + file write');

const create = await fetchJson(`${base}/api/projects`, {
  method: 'POST',
  headers: authHeaders(token),
  body: JSON.stringify({ name: `journey-${process.pid}` }),
});
const projectId = create.body?.data?.id;
ok(
  'POST /api/projects → 201',
  (create.res.status === 201 || create.res.ok) && Boolean(projectId),
  projectId || create.body?.error || `status=${create.res.status}`,
);

let writeHash = '';
if (projectId) {
  const put = await fetchJson(`${base}/api/projects/${projectId}/files/index.html`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({
      content: '<!DOCTYPE html><html><body><main id="hero">journey</main></body></html>',
      source: 'user',
    }),
  });
  writeHash = put.body?.data?.hash || '';
  ok(
    'PUT files/index.html → 200 + hash',
    put.res.ok && put.body?.ok === true && typeof writeHash === 'string' && writeHash.length > 7,
    put.body?.error || `status=${put.res.status} hash=${writeHash}`,
  );
  ok(
    'write body uses hash not contentHash on data',
    put.body?.data != null && !Object.prototype.hasOwnProperty.call(put.body.data, 'contentHash'),
    put.body?.data ? Object.keys(put.body.data).join(',') : 'no data',
  );

  const get = await fetchJson(`${base}/api/projects/${projectId}/files/index.html`, {
    headers: authHeaders(token),
  });
  const content = get.body?.data?.content ?? get.body?.data?.text ?? '';
  ok(
    'GET files/index.html returns content',
    get.res.ok && typeof content === 'string' && content.includes('journey'),
    `status=${get.res.status}`,
  );
}

// ── Collab + locks ─────────────────────────────────────────

section('3. Collab sessions + lock conflict + hard-enforce');

/** Open collab SSE until ready sessionId. */
async function openCollab(projectId, displayName, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${base}/api/projects/${encodeURIComponent(projectId)}/collab/stream?name=${encodeURIComponent(displayName)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return { ok: false, error: `HTTP ${res.status}`, close: () => {} };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let sessionId = '';
    const started = Date.now();
    while (Date.now() - started < timeoutMs && !sessionId) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const ready = /event:\s*ready\s*\ndata:\s*(\{[^\n]+\})/.exec(buf);
      if (ready) {
        try {
          const j = JSON.parse(ready[1]);
          if (typeof j.sessionId === 'string') sessionId = j.sessionId;
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
    if (!sessionId) return { ok: false, error: 'no sessionId', close };
    return { ok: true, sessionId, close };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: String(e?.message || e), close: () => {} };
  }
}

let streamA = { ok: false, close: () => {} };
let streamB = { ok: false, close: () => {} };

if (projectId) {
  streamA = await openCollab(projectId, 'JourneyAlice');
  ok('collab stream A ready', streamA.ok, streamA.error || streamA.sessionId);
  streamB = await openCollab(projectId, 'JourneyBob');
  ok('collab stream B ready', streamB.ok, streamB.error || streamB.sessionId);

  if (streamA.ok && streamB.ok) {
    const acq = await fetchJson(`${base}/api/projects/${projectId}/collab/locks`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        sessionId: streamA.sessionId,
        path: 'index.html',
        action: 'acquire',
      }),
    });
    ok('lock acquire A', acq.res.ok && acq.body?.ok === true, acq.body?.error || '');

    const conflict = await fetchJson(`${base}/api/projects/${projectId}/collab/locks`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        sessionId: streamB.sessionId,
        path: 'index.html',
        action: 'acquire',
      }),
    });
    ok(
      'lock conflict B → 409 + holder',
      conflict.res.status === 409
        && conflict.body?.data?.holder?.sessionId === streamA.sessionId,
      `status=${conflict.res.status} holder=${conflict.body?.data?.holder?.sessionId || 'none'}`,
    );

    const foreign = await fetchJson(`${base}/api/projects/${projectId}/files/index.html`, {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'x-neos-session-id': streamB.sessionId,
      },
      body: JSON.stringify({
        content: '<html><body>blocked</body></html>',
        source: 'user',
        sessionId: streamB.sessionId,
      }),
    });
    ok(
      'foreign user PUT → 423 under NEOS_SHARED_EDIT',
      foreign.res.status === 423,
      `status=${foreign.res.status}`,
    );
    ok(
      '423 holder is session A',
      foreign.body?.data?.holder?.sessionId === streamA.sessionId,
      foreign.body?.data?.holder?.sessionId || 'no holder',
    );

    const holderPut = await fetchJson(`${base}/api/projects/${projectId}/files/index.html`, {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'x-neos-session-id': streamA.sessionId,
      },
      body: JSON.stringify({
        content: '<html><body>holder-ok</body></html>',
        source: 'user',
        sessionId: streamA.sessionId,
      }),
    });
    ok(
      'holder user PUT → 200',
      holderPut.res.ok && holderPut.body?.ok === true,
      `status=${holderPut.res.status}`,
    );
  }
}

// ── Runs dry-run ───────────────────────────────────────────

section('4. Dry-run create + terminal cancel');

const runCreate = await fetchJson(`${base}/api/runs`, {
  method: 'POST',
  headers: authHeaders(token),
  body: JSON.stringify({
    prompt: 'journey dry-run',
    dryRun: true,
    ...(projectId ? { projectId } : {}),
  }),
});
const runId = runCreate.body?.data?.id;
ok(
  'POST /api/runs dryRun → created',
  (runCreate.res.ok || runCreate.res.status === 201) && Boolean(runId),
  runId || runCreate.body?.error || `status=${runCreate.res.status}`,
);

if (runId) {
  // dry-run often terminal immediately
  await sleep(300);
  const cancel1 = await fetchJson(`${base}/api/runs/${runId}/cancel`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  ok(
    'cancel dry-run → 200 or 409 terminal',
    cancel1.res.status === 200 || cancel1.res.status === 409,
    `status=${cancel1.res.status}`,
  );

  const cancel2 = await fetchJson(`${base}/api/runs/${runId}/cancel`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  ok(
    'second cancel on terminal → 409',
    cancel2.res.status === 409,
    `status=${cancel2.res.status}`,
  );
}

streamA.close?.();
streamB.close?.();
cleanup();

section('Summary');
if (failures.length === 0) {
  process.stdout.write('\nAll journey checks passed (T2 process E2E).\n');
  process.exit(0);
}
process.stdout.write(`\n${failures.length} check(s) failed:\n`);
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(1);
