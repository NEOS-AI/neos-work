#!/usr/bin/env node
/**
 * Browser E2E entry (v0.15 M2).
 *
 * Preconditions: Node 22+, built server dist, Playwright Chromium installed.
 *
 *   pnpm --filter @neos-work/server... build
 *   pnpm exec playwright install chromium
 *   pnpm e2e:browser
 *
 * Exit 0 on success, 1 on failure.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  process.stderr.write(
    `e2e:browser: Node.js 22+ required (got v${process.versions.node})\n`,
  );
  process.exit(1);
}

const entry = path.join(ROOT, 'apps/server/dist/index.js');
if (!fs.existsSync(entry)) {
  process.stderr.write(
    'e2e:browser: server dist missing — run:\n'
      + '  pnpm --filter @neos-work/server... build\n',
  );
  process.exit(1);
}

const config = path.join(__dirname, 'playwright.config.ts');
const r = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', config],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
    shell: false,
  },
);

process.exit(r.status ?? 1);
