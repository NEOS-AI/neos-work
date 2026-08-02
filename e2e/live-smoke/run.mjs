#!/usr/bin/env node
/**
 * Opt-in live provider smoke (PLAN_FOR_V0_5_29 Task C1).
 *
 * Default CI / local without env:
 *   exit 0, prints SKIP — never fails the build.
 *
 * Opt-in:
 *   NEOS_LIVE_SMOKE=1 node e2e/live-smoke/run.mjs
 *   pnpm e2e:live-smoke   # still needs NEOS_LIVE_SMOKE=1 to run probes
 *
 * What runs when enabled:
 *   1. Capability inventory sanity (same gates as e2e:smoke section 3)
 *   2. Public HTTP reachability probes (no request bodies with secrets;
 *      response bodies never printed). 401/403 count as reachable.
 *   3. If NEOS_SERVER_URL + NEOS_AUTH_TOKEN are set, POST /api/connection-test
 *      for cli-agents, openai, anthropic, ollama.
 *
 * Exit 0 on success or skip; 1 on failure when live mode is on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../../tools/inventory/inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const LIVE = process.env.NEOS_LIVE_SMOKE === '1' || process.env.NEOS_LIVE_SMOKE === 'true';

const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(name);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function envToken() {
  const t = process.env.NEOS_AUTH_TOKEN || process.env.NEOS_TOKEN || '';
  if (!t || /[\0\r\n]/.test(t)) return '';
  return t.trim();
}

function envServerUrl() {
  const u = (process.env.NEOS_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (!u || /[\0\r\n]/.test(u)) return '';
  return u;
}

/** Probe without leaking bodies. 401/403 = reachable (auth wall). */
async function probeHttp(name, url, { headers = {}, allowPrivate = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    ok(name, false, `bad url: ${e}`);
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    ok(name, false, 'only http(s)');
    return;
  }
  if (!allowPrivate) {
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host === '169.254.169.254' ||
      host === 'metadata.google.internal'
    ) {
      ok(name, false, 'blocked host (use allowPrivate for intentional local)');
      return;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(parsed.href, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'neos-work-live-smoke/0.7.1',
        ...headers,
      },
    });
    // Do not read body — may contain data we must not log
    const reachable =
      (res.status > 0 && res.status < 600) ||
      (res.status >= 300 && res.status < 400);
    ok(
      name,
      reachable,
      reachable ? `HTTP ${res.status}` : `unexpected status ${res.status}`,
    );
  } catch (err) {
    const msg = err && typeof err === 'object' && 'name' in err && err.name === 'AbortError'
      ? 'timeout'
      : String(err && err.message ? err.message : err);
    ok(name, false, msg);
  } finally {
    clearTimeout(timer);
  }
}

async function probeConnectionTest(base, token, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${base}/api/connection-test`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'neos-work-live-smoke/0.7.1',
      },
      body: JSON.stringify({ target }),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      ok(`daemon connection-test ${target}`, false, `non-JSON HTTP ${res.status}`);
      return;
    }
    // Never print nested bodies; only ok / reachable / message
    const msg =
      typeof json?.data?.message === 'string'
        ? json.data.message
        : typeof json?.error === 'string'
          ? json.error
          : `HTTP ${res.status}`;

    if (target === 'cli-agents') {
      ok(`daemon connection-test ${target}`, json?.ok === true && json?.data?.reachable === true, msg);
      return;
    }

    // Provider targets: reachable true passes; blocked is a fail; unreachable fails
    if (json?.ok === true && json?.data?.reachable === true) {
      ok(`daemon connection-test ${target}`, true, msg);
    } else if (json?.ok === true && json?.data?.blocked) {
      ok(`daemon connection-test ${target}`, false, `SSRF blocked — ${msg}`);
    } else {
      ok(`daemon connection-test ${target}`, false, msg);
    }
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    ok(`daemon connection-test ${target}`, false, msg);
  } finally {
    clearTimeout(timer);
  }
}

// --- main ---

process.stdout.write('NEOS Work live provider smoke\n');

if (!LIVE) {
  process.stdout.write(
    '\nSKIP: set NEOS_LIVE_SMOKE=1 to run live probes.\n' +
      '  Example: NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke\n' +
      '  Optional daemon: NEOS_SERVER_URL + NEOS_AUTH_TOKEN\n',
  );
  process.exit(0);
}

section('1. Inventory sanity');
try {
  const inv = buildInventory();
  ok(`version present (${inv.version})`, Boolean(inv.version));
  for (const r of inv.checks.results) {
    ok(`gate ${r.id} ≥ ${r.min} (got ${r.actual})`, r.ok);
  }
  ok(
    'agent catalog non-empty',
    Array.isArray(inv.catalogs?.agentCliDefs?.ids) && inv.catalogs.agentCliDefs.ids.length >= 12,
    `count=${inv.catalogs?.agentCliDefs?.ids?.length ?? 0}`,
  );
} catch (e) {
  ok('buildInventory', false, String(e));
}

section('2. Public endpoint reachability (no secrets, no body log)');
// 401/403 still mean the edge is up — expected without API keys
await probeHttp('openai /v1/models', 'https://api.openai.com/v1/models');
await probeHttp('anthropic /v1/messages', 'https://api.anthropic.com/v1/messages', {
  headers: {
    'anthropic-version': '2023-06-01',
  },
});

// Ollama is local-only; probe only if explicitly requested
if (process.env.NEOS_LIVE_SMOKE_OLLAMA === '1') {
  const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  await probeHttp('ollama /api/tags', `${base}/api/tags`, { allowPrivate: true });
} else {
  process.stdout.write('  · ollama skipped (set NEOS_LIVE_SMOKE_OLLAMA=1 to probe local)\n');
}

section('3. Daemon connection-test (optional)');
const base = envServerUrl();
const token = envToken();
if (!base || !token) {
  process.stdout.write(
    '  · skipped — set NEOS_SERVER_URL and NEOS_AUTH_TOKEN to hit /api/connection-test\n',
  );
} else {
  for (const target of ['cli-agents', 'openai', 'anthropic', 'ollama']) {
    await probeConnectionTest(base, token, target);
  }
}

// Ensure plan file exists (closeout contract)
section('4. Closeout docs');
ok(
  'docs/plans/PLAN_FOR_V0_5_29.md',
  fs.existsSync(path.join(ROOT, 'docs/plans/PLAN_FOR_V0_5_29.md')),
);
ok(
  'docs/security/v0.5.md',
  fs.existsSync(path.join(ROOT, 'docs/security/v0.5.md')),
);

section('Summary');
if (failures.length === 0) {
  process.stdout.write('\nAll live smoke checks passed.\n');
  process.exit(0);
}
process.stdout.write(`\n${failures.length} check(s) failed:\n`);
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(1);
