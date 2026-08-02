#!/usr/bin/env node
/**
 * e2e smoke suite (PLAN_FOR_V0_5_0 Task 17).
 *
 * Contract + inventory gates without live providers:
 *   1. OD sample fixture present
 *   2. Skill / design-system / plugin manifests load
 *   3. Capability inventory gates pass
 *   4. MCP tool list non-empty
 *
 * Usage:
 *   node e2e/smoke/run.mjs
 *   pnpm e2e:smoke
 *
 * Exit 0 on success, 1 on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory } from '../../tools/inventory/inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
    failures.push(name);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

section('1. OD fixtures');
ok('e2e/fixtures/od-samples/index.html exists', exists('e2e/fixtures/od-samples/index.html'));
if (exists('e2e/fixtures/od-samples/index.html')) {
  const html = read('e2e/fixtures/od-samples/index.html');
  ok('fixture has hero section', /id=["']hero["']/.test(html) || /class=["']hero["']/.test(html));
  ok('fixture has Layers-friendly structure (header/main)', /<header[\s>]/.test(html) && /<main[\s>]/.test(html));
}

section('2. Bundled catalogs (contract load)');
const skillDirs = ['api-docs', 'code-review', 'design-critique', 'refactor-safe', 'web-landing'];
for (const s of skillDirs) {
  ok(`skill package ${s}/SKILL.md`, exists(`skills/${s}/SKILL.md`));
}
ok('design-system neos-default/manifest.json', exists('design-systems/neos-default/manifest.json'));
ok('design-system minimal-mono/manifest.json', exists('design-systems/minimal-mono/manifest.json'));
if (exists('design-systems/neos-default/manifest.json')) {
  try {
    const m = JSON.parse(read('design-systems/neos-default/manifest.json'));
    ok('neos-default manifest has schema/name', Boolean(m.schema || m.name || m.id));
  } catch (e) {
    ok('neos-default manifest JSON', false, String(e));
  }
}
ok('plugin _official/code-critique', exists('plugins/_official/code-critique/open-design.json'));
ok('plugin _official/landing-gen', exists('plugins/_official/landing-gen/open-design.json'));
ok('plugin community/hello-plugin', exists('plugins/community/hello-plugin/open-design.json'));

section('3. Capability inventory gates');
const inv = buildInventory();
ok(`version present (${inv.version})`, Boolean(inv.version));
for (const r of inv.checks.results) {
  ok(`gate ${r.id} ≥ ${r.min} (got ${r.actual})`, r.ok);
}
ok('mcp tools include neos_files_read', inv.catalogs.mcpTools.ids.includes('neos_files_read'));
ok(
  'agent catalog includes cli-claude',
  inv.catalogs.agentCliDefs.ids.includes('cli-claude'),
);

section('4. Dual-surface docs present');
ok('docs/migration/v0.5.0.md', exists('docs/migration/v0.5.0.md'));
ok('docs/migration/v0.6.0.md', exists('docs/migration/v0.6.0.md'));
ok('docs/security/v0.5.md', exists('docs/security/v0.5.md'));
ok('docs/plans/PLAN_FOR_V0_6_0.md', exists('docs/plans/PLAN_FOR_V0_6_0.md'));
ok('deploy/helm/neos-work/Chart.yaml', exists('deploy/helm/neos-work/Chart.yaml'));
const readme = exists('README.md') ? read('README.md') : '';
ok('README mentions Design Project or Design Editor', /Design (Project|Editor)/i.test(readme));
ok('README mentions Workflow', /[Ww]orkflow/.test(readme));

section('5. v0.6 inventory feature gates');
const v06 = inv.catalogs?.v06Features;
ok('inventory v06Features present', Boolean(v06));
ok(
  `v06Features complete (${v06?.count ?? 0}/${v06?.total ?? '?'})`,
  Boolean(v06?.ok),
  v06?.missing?.length ? v06.missing.join(',') : '',
);

section('Summary');
if (failures.length === 0) {
  process.stdout.write('\nAll smoke checks passed.\n');
  process.exit(0);
}
process.stdout.write(`\n${failures.length} check(s) failed:\n`);
for (const f of failures) process.stdout.write(`  - ${f}\n`);
process.exit(1);
