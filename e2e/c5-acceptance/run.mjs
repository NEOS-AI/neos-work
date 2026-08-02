#!/usr/bin/env node
/**
 * C5 acceptance runner (PLAN_FOR_V0_5_29 Task C5).
 *
 * Automates the Design Editor scenario *coverage* that backs the operator
 * checklist — unit/integration suites for generate→edit loop contracts,
 * Layers, Edit-with-AI defaults, and disk-changed conflict handling.
 *
 * Docker compose is a separate step (see --docker or docs).
 *
 * Usage:
 *   node e2e/c5-acceptance/run.mjs
 *   pnpm e2e:c5
 *   node e2e/c5-acceptance/run.mjs --docker   # optional compose health smoke
 *
 * Exit 0 on success, 1 on failure.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const wantDocker = process.argv.includes('--docker');

const failures = [];

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function ok(name, cond, detail = '') {
  if (cond) process.stdout.write(`  ✓ ${name}${detail ? ` — ${detail}` : ''}\n`);
  else {
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(name);
  }
}

function run(label, command, args, opts = {}) {
  process.stdout.write(`\n→ ${label}\n`);
  const r = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    shell: false,
  });
  const code = r.status ?? 1;
  ok(label, code === 0, code === 0 ? 'exit 0' : `exit ${code}`);
  return code === 0;
}

process.stdout.write('NEOS Work C5 acceptance (Design Editor + optional Docker)\n');

section('0. Plan artifacts');
ok(
  'PLAN_FOR_V0_5_29 exists',
  fs.existsSync(path.join(ROOT, 'docs/plans/PLAN_FOR_V0_5_29.md')),
);
ok(
  'v0.5.29 implementation note exists',
  fs.existsSync(path.join(ROOT, 'docs/implementation/v0.5/v0.5.29.md')),
);

// Map C5 manual scenarios → automated suites
section('1. Design Editor package (Layers, dirty/disk-changed, EditContext)');
run(
  'design-editor vitest',
  'pnpm',
  ['--filter', '@neos-work/design-editor', 'exec', 'vitest', 'run'],
);

section('2. Desktop ProjectWorkspace (SSE disk-changed, Edit with AI)');
run(
  'desktop ProjectWorkspace tests',
  'pnpm',
  [
    '--filter',
    '@neos-work/desktop',
    'exec',
    'vitest',
    'run',
    'src/pages/ProjectWorkspace.test.tsx',
  ],
);

section('3. Web ProjectDetail (Edit with AI + reload)');
run(
  'web ProjectDetail tests',
  'pnpm',
  [
    '--filter',
    '@neos-work/web',
    'exec',
    'vitest',
    'run',
    'src/pages/ProjectDetail.test.tsx',
  ],
);

section('4. Contract smoke (fixtures + inventory)');
run('e2e:smoke', 'pnpm', ['e2e:smoke']);

if (wantDocker) {
  section('5. Docker compose health smoke');
  const envPath = path.join(ROOT, 'deploy/.env');
  if (!fs.existsSync(envPath)) {
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(
      envPath,
      `NEOS_AUTH_TOKEN=${token}\nNEOS_PORT=3000\n`,
      'utf8',
    );
    process.stdout.write('  · wrote deploy/.env with random token\n');
  }

  const up = spawnSync(
    'docker',
    ['compose', '-f', 'deploy/docker-compose.yml', 'up', '-d', '--build'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  ok('docker compose up --build', (up.status ?? 1) === 0);

  if ((up.status ?? 1) === 0) {
    // Wait for health up to ~120s
    let healthy = false;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const res = spawnSync(
          'curl',
          ['-sf', 'http://127.0.0.1:3000/api/health'],
          { encoding: 'utf8' },
        );
        if (res.status === 0 && res.stdout) {
          let j;
          try {
            j = JSON.parse(res.stdout);
          } catch {
            j = null;
          }
          if (j && (j.ok === true || j.status === 'ok' || j.version)) {
            healthy = true;
            ok(
              'GET /api/health',
              true,
              typeof j.version === 'string' ? `version ${j.version}` : 'ok',
            );
            break;
          }
        }
      } catch {
        // retry
      }
      spawnSync('sleep', ['3']);
    }
    if (!healthy) ok('GET /api/health', false, 'timeout waiting for healthy');

    // Tear down to leave host clean (volume preserved)
    const down = spawnSync(
      'docker',
      ['compose', '-f', 'deploy/docker-compose.yml', 'down'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    ok('docker compose down', (down.status ?? 1) === 0);
  }
} else {
  section('5. Docker compose');
  process.stdout.write(
    '  · skipped — pass --docker to build/up and probe /api/health\n',
  );
}

section('Summary — C5 scenario mapping');
process.stdout.write(`
  Manual scenario                         Automated coverage
  --------------------------------------  --------------------------------
  generate → Code edit → Preview          design-editor DesignEditor + dirty-state
  Layers select / visibility              design-editor LayersPanel + html-layers
  Edit with AI (replace-selection)        selection-state + ProjectWorkspace/Detail
  dirty + agent write conflict            dirty-state disk-changed + SSE tests
  OD fixtures / inventory                 e2e:smoke
  Docker UI reachable ~5m                 --docker health probe
`);

if (failures.length === 0) {
  process.stdout.write('\nC5 acceptance checks passed.\n');
  process.exit(0);
}
process.stdout.write(`\n${failures.length} check(s) failed:\n`);
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(1);
