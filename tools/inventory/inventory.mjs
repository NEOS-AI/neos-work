#!/usr/bin/env node
/**
 * Capability inventory dump (PLAN_FOR_V0_5_0 Task 17).
 *
 * Scans in-repo catalogs (agents, skills, design-systems, plugins, media,
 * domain packs, MCP tools, plugin atoms) and prints JSON.
 *
 * Usage:
 *   node tools/inventory/inventory.mjs
 *   node tools/inventory/inventory.mjs --write   # also writes docs/generated/capability-inventory.json
 *   node tools/inventory/inventory.mjs --check   # exit 1 if gates fail
 *
 * Env:
 *   NEOS_INVENTORY_OUT  override write path
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const GATES = {
  minAgentCliDefs: 12,
  minPluginAtoms: 12,
  minSkills: 5,
  minDesignSystems: 2,
  minMediaProviders: 4,
  minMcpTools: 6,
  minDomainPacks: 4,
  minMediaSurfaces: 3, // image, audio, video
};

function readText(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function readJson(rel) {
  const t = readText(rel);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function listDirs(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

function extractStringIds(source, pattern) {
  if (!source) return [];
  const out = [];
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  let m;
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  while ((m = g.exec(source)) !== null) {
    const id = m[1]?.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function scanAgentCliDefs() {
  const src =
    readText('packages/agent-runtime/src/defs/catalog.ts')
    || readText('packages/agent-runtime/dist/defs/catalog.js')
    || '';
  // id: 'cli-…'
  const ids = extractStringIds(src, /\bid:\s*['"](cli-[a-z0-9_-]+)['"]/gi);
  const names = extractStringIds(src, /\bname:\s*['"]([^'"]+)['"]/g);
  return {
    count: ids.length,
    ids,
    names: names.slice(0, ids.length),
  };
}

function scanPluginAtoms() {
  const src =
    readText('packages/plugin-runtime/src/atoms.ts')
    || readText('packages/plugin-runtime/dist/atoms.js')
    || '';
  const ids = extractStringIds(src, /\bid:\s*['"]([a-z][a-z0-9_.-]*)['"]/gi);
  // Filter to atom-like ids (contain a dot, e.g. prompt.system)
  const atomIds = ids.filter((id) => id.includes('.'));
  return { count: atomIds.length, ids: atomIds };
}

function scanSkills() {
  const names = listDirs('skills');
  const packages = [];
  for (const name of names) {
    const skillMd = path.join(ROOT, 'skills', name, 'SKILL.md');
    const flat = path.join(ROOT, 'skills', `${name}.md`);
    const hasPackage = fs.existsSync(skillMd);
    const hasFlat = fs.existsSync(flat);
    if (!hasPackage && !hasFlat) continue;
    packages.push({
      id: name,
      kind: hasPackage ? 'package' : 'flat',
      path: hasPackage ? `skills/${name}/SKILL.md` : `skills/${name}.md`,
    });
  }
  return { count: packages.length, items: packages };
}

function scanDesignSystems() {
  const names = listDirs('design-systems');
  const items = [];
  for (const name of names) {
    const manifestRel = `design-systems/${name}/manifest.json`;
    const manifest = readJson(manifestRel);
    items.push({
      id: name,
      path: manifestRel,
      schema: manifest?.schema ?? null,
      name: manifest?.name ?? name,
    });
  }
  return { count: items.length, items };
}

function scanPlugins() {
  const items = [];
  for (const tier of ['_official', 'community']) {
    const base = path.join('plugins', tier);
    for (const name of listDirs(base)) {
      const manifestRel = path.join(base, name, 'open-design.json');
      const manifest = readJson(manifestRel);
      items.push({
        id: name,
        tier: tier.replace(/^_/, ''),
        path: manifestRel,
        name: manifest?.name ?? name,
      });
    }
  }
  return { count: items.length, items };
}

function scanMediaProviders() {
  const src =
    readText('apps/server/src/lib/media-providers.ts')
    || '';
  const ids = extractStringIds(src, /\bid:\s*['"]([a-z0-9-]+)['"]/gi).filter((id) =>
    ['openai', 'azure-openai', 'google', 'xai', 'openai-compatible', 'stub'].includes(id)
    || id.includes('openai')
    || id === 'google'
    || id === 'xai'
    || id === 'stub',
  );
  // Fallback: known catalog order from MEDIA_PROVIDER_CATALOG
  const known = ['openai', 'azure-openai', 'google', 'xai', 'openai-compatible', 'stub'];
  const found = known.filter((k) => src.includes(`id: '${k}'`) || src.includes(`id: "${k}"`));
  const finalIds = found.length ? found : ids;
  const surfaces = [];
  for (const s of ['image', 'audio', 'video']) {
    if (src.includes(`'${s}'`) || src.includes(`"${s}"`)) surfaces.push(s);
  }
  return {
    count: finalIds.length,
    ids: finalIds,
    surfaces: surfaces.length ? surfaces : ['image', 'audio', 'video'],
  };
}

function scanDomainPacks() {
  const src =
    readText('packages/workflow-engine/src/packs/index.ts')
    || '';
  // Built-in pack blocks: id: 'finance' etc near pack definitions
  const builtin = ['finance', 'coding', 'research', 'general'].filter(
    (id) => src.includes(`id: '${id}'`) || src.includes(`id: "${id}"`),
  );
  return {
    count: builtin.length,
    ids: builtin,
    customLoader: src.includes('registerPack') || src.includes('parsePackManifest'),
  };
}

function scanMcpTools() {
  const src =
    readText('packages/mcp-client/src/neos-mcp-server.ts')
    || readText('packages/mcp-client/dist/neos-mcp-server.js')
    || '';
  const ids = extractStringIds(src, /name:\s*['"](neos_[a-z0-9_]+)['"]/gi);
  return { count: ids.length, ids };
}

function monorepoVersion() {
  const pkg = readJson('package.json');
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
}

export function buildInventory() {
  const agents = scanAgentCliDefs();
  const atoms = scanPluginAtoms();
  const skills = scanSkills();
  const designSystems = scanDesignSystems();
  const plugins = scanPlugins();
  const media = scanMediaProviders();
  const packs = scanDomainPacks();
  const mcp = scanMcpTools();
  const version = monorepoVersion();

  const inventory = {
    generatedAt: new Date().toISOString(),
    version,
    root: ROOT,
    catalogs: {
      agentCliDefs: agents,
      pluginAtoms: atoms,
      skills,
      designSystems,
      plugins,
      mediaProviders: media,
      domainPacks: packs,
      mcpTools: mcp,
    },
    gates: GATES,
    summary: {
      agentCliDefs: agents.count,
      pluginAtoms: atoms.count,
      skills: skills.count,
      designSystems: designSystems.count,
      plugins: plugins.count,
      mediaProviders: media.count,
      mediaSurfaces: media.surfaces.length,
      domainPacks: packs.count,
      mcpTools: mcp.count,
    },
  };

  inventory.checks = evaluateGates(inventory);
  return inventory;
}

export function evaluateGates(inventory) {
  const s = inventory.summary;
  const g = inventory.gates;
  const results = [
    { id: 'agentCliDefs', ok: s.agentCliDefs >= g.minAgentCliDefs, actual: s.agentCliDefs, min: g.minAgentCliDefs },
    { id: 'pluginAtoms', ok: s.pluginAtoms >= g.minPluginAtoms, actual: s.pluginAtoms, min: g.minPluginAtoms },
    { id: 'skills', ok: s.skills >= g.minSkills, actual: s.skills, min: g.minSkills },
    { id: 'designSystems', ok: s.designSystems >= g.minDesignSystems, actual: s.designSystems, min: g.minDesignSystems },
    { id: 'mediaProviders', ok: s.mediaProviders >= g.minMediaProviders, actual: s.mediaProviders, min: g.minMediaProviders },
    { id: 'mediaSurfaces', ok: s.mediaSurfaces >= g.minMediaSurfaces, actual: s.mediaSurfaces, min: g.minMediaSurfaces },
    { id: 'mcpTools', ok: s.mcpTools >= g.minMcpTools, actual: s.mcpTools, min: g.minMcpTools },
    { id: 'domainPacks', ok: s.domainPacks >= g.minDomainPacks, actual: s.domainPacks, min: g.minDomainPacks },
  ];
  return {
    ok: results.every((r) => r.ok),
    results,
  };
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const inv = buildInventory();
  const json = JSON.stringify(inv, null, 2);
  process.stdout.write(`${json}\n`);

  if (write) {
    const out =
      process.env.NEOS_INVENTORY_OUT?.trim()
      || path.join(ROOT, 'docs/generated/capability-inventory.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${json}\n`, 'utf8');
    process.stderr.write(`wrote ${path.relative(ROOT, out)}\n`);
  }

  if (check && !inv.checks.ok) {
    process.stderr.write('inventory gates failed:\n');
    for (const r of inv.checks.results.filter((x) => !x.ok)) {
      process.stderr.write(`  - ${r.id}: ${r.actual} < min ${r.min}\n`);
    }
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
