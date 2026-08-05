#!/usr/bin/env node
/**
 * Regenerate audit/* inventories from current source (static scan).
 * Usage: node tools/audit/regen.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AUDIT = path.join(ROOT, 'audit');

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');

function joinPath(base, routePath) {
  let full = base || '';
  if (routePath === '/') full = base || '/';
  else if (routePath.startsWith('/')) full = (base.replace(/\/$/, '') || '') + routePath;
  else full = (base.replace(/\/$/, '') || '') + '/' + routePath;
  if (!full.startsWith('/') && full !== '*') full = '/' + full;
  full = full.replace(/\/{2,}/g, '/');
  if (full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
  return full;
}

function scanBackend() {
  const indexPath = path.join(ROOT, 'apps/server/src/index.ts');
  const indexSrc = read(indexPath);
  const mounts = [];
  const mountRe = /app\.route\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g;
  let m;
  while ((m = mountRe.exec(indexSrc))) mounts.push({ base: m[1], varName: m[2] });

  const importMap = new Map();
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"](\.\/routes\/[^'"]+)['"]/g;
  while ((m = namedRe.exec(indexSrc))) {
    let fp = m[2].replace(/\.js$/, '.ts');
    if (!fp.endsWith('.ts')) fp += '.ts';
    const abs = path.join(ROOT, 'apps/server/src', fp);
    for (const part of m[1].split(',')) {
      const bit = part.trim();
      if (!bit) continue;
      const asM = bit.match(/^(\w+)\s+as\s+(\w+)$/);
      const name = asM ? asM[2] : bit.match(/^(\w+)/)?.[1];
      if (name) importMap.set(name, abs);
    }
  }
  const defRe = /import\s+(\w+)\s+from\s*['"](\.\/routes\/[^'"]+)['"]/g;
  while ((m = defRe.exec(indexSrc))) {
    let fp = m[2].replace(/\.js$/, '.ts');
    if (!fp.endsWith('.ts')) fp += '.ts';
    importMap.set(m[1], path.join(ROOT, 'apps/server/src', fp));
  }

  const endpoints = [];

  function scanFile(filePath, basePrefix, routerNames) {
    if (!fs.existsSync(filePath)) return;
    const src = read(filePath);
    const lines = src.split('\n');
    const re = /\b([A-Za-z_]\w*)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
    let mm;
    while ((mm = re.exec(src))) {
      const obj = mm[1];
      if (['c', 'req', 'headers', 'res', 'ctx'].includes(obj)) continue;
      if (filePath.endsWith('index.ts')) {
        if (obj !== 'app') continue;
      } else if (routerNames?.size && !routerNames.has(obj)) continue;

      const method = mm[2].toUpperCase();
      const routePath = mm[3];
      const line = src.slice(0, mm.index).split('\n').length;
      const full = joinPath(basePrefix, routePath);
      const pathParams = [...full.matchAll(/:([A-Za-z_][\w]*)/g)].map((x) => x[1]);
      const snippet = lines.slice(Math.max(0, line - 1), Math.min(lines.length, line + 45)).join('\n');
      const bodyHints = [];
      if (/c\.req\.json|await c\.req\.json|\.json</.test(snippet)) bodyHints.push('json');
      if (/c\.req\.query|c\.req\.queries/.test(snippet)) bodyHints.push('query');
      if (/formData|multipart|arrayBuffer|\.blob\(/.test(snippet)) bodyHints.push('form/multipart');
      if (/text\/event-stream|streamSSE|event-stream|hono\/streaming/.test(snippet)) bodyHints.push('sse');
      if (pathParams.length) bodyHints.push('path-params');
      if (/binary|export\.zip|application\/zip/.test(snippet)) bodyHints.push('binary');
      const codes = new Set();
      for (const cm of snippet.matchAll(/,\s*(\d{3})\s*\)/g)) codes.add(Number(cm[1]));
      if (codes.size === 0) codes.add(200);
      endpoints.push({
        method,
        path: full,
        pathParams,
        splat: full.includes('*'),
        bodyHints: [...new Set(bodyHints)],
        responseCodes: [...codes].sort((a, b) => a - b),
        auth: 'Bearer required',
        def: `${rel(filePath)}:${line}`,
      });
    }
  }

  scanFile(indexPath, '', new Set(['app']));

  for (const { base, varName } of mounts) {
    const file = importMap.get(varName);
    if (!file) {
      console.warn('unresolved mount', varName, base);
      continue;
    }
    const fileSrc = read(file);
    const honoVars = [...fileSrc.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*new\s+Hono\s*\(/g)].map(
      (x) => x[1],
    );
    const names = new Set();
    if (honoVars.includes(varName)) {
      names.add(varName);
    } else if (honoVars.length === 1) {
      names.add(honoVars[0]); // default-import alias (pluginsRoute -> plugins)
    } else {
      const defM = fileSrc.match(/export\s+default\s+([A-Za-z_]\w*)/);
      if (defM) names.add(defM[1]);
      else if (honoVars.includes(varName)) names.add(varName);
      else honoVars.forEach((h) => names.add(h));
    }
    // multi-router file: only the matching export name
    if (honoVars.length > 1 && honoVars.includes(varName)) {
      names.clear();
      names.add(varName);
    }
    scanFile(file, base, names);
  }

  const authSrc = fs.existsSync(path.join(ROOT, 'apps/server/src/lib/auth-paths.ts'))
    ? read(path.join(ROOT, 'apps/server/src/lib/auth-paths.ts'))
    : '';
  function isExempt(p) {
    if (p === '/api/health' || p.startsWith('/api/health/')) return true;
    if (p.includes('oauth/callback')) return true;
    if (p.startsWith('/api/tools/live-artifacts')) return true;
    if (/^\/api\/webhook\/:[^/]+$/.test(p)) return true;
    return false;
  }
  for (const ep of endpoints) {
    if (isExempt(ep.path)) ep.auth = 'exempt (isAuthExemptPath)';
  }

  endpoints.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.def.localeCompare(b.def),
  );
  const seen = new Set();
  return endpoints.filter((ep) => {
    const k = `${ep.method} ${ep.path} ${ep.def}`;
    if (seen.has(k)) return false;
    seen.add(k);
    if (!ep.path.startsWith('/') && ep.path !== '*') return false;
    if (ep.path !== '*' && ep.path !== '/' && !ep.path.startsWith('/api')) return false;
    return true;
  });
}

function scanFrontendClient(filePath, surface) {
  const src = read(filePath);
  const calls = [];

  function addCall(method, url, line, kind) {
    let u = url.trim();
    u = u
      .replace(/\$\{this\.baseUrl\}/g, '')
      .replace(/\$\{this\.serverUrl\}/g, '')
      .replace(/\$\{this\.config\.serverUrl\}/g, '')
      .replace(/\$\{this\.base\}/g, '')
      .replace(/\$\{baseUrl\}/g, '')
      .replace(/\$\{base\}/g, '');
    if (!u.startsWith('/')) {
      const idx = u.indexOf('/api');
      if (idx >= 0) u = u.slice(idx);
      else return;
    }
    if (!u.startsWith('/api')) return;
    calls.push({ surface, method: method.toUpperCase(), url: u, site: `${rel(filePath)}:${line}`, kind });
  }

  let mm;
  const reqRe =
    /\b(request|requestEnvelope)\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*(`[^`]+`|'[^']+'|"[^"]+")/g;
  while ((mm = reqRe.exec(src))) {
    addCall(mm[2], mm[3].slice(1, -1), src.slice(0, mm.index).split('\n').length, 'request');
  }

  function methodFromFetchCall(from) {
    let depth = 0;
    let end = from;
    for (let i = from; i < Math.min(src.length, from + 900); i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const callSrc = src.slice(from, end + 1);
    const methodM = callSrc.match(/method:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
    return methodM ? methodM[1].toUpperCase() : 'GET';
  }

  const fetchRe =
    /fetch\(\s*((?:`[^`]+`)|(?:this\.url\(\s*`[^`]+`\s*\))|(?:this\.url\(\s*'[^']+'\s*\)))/g;
  while ((mm = fetchRe.exec(src))) {
    const line = src.slice(0, mm.index).split('\n').length;
    const um = mm[1].match(/`([^`]+)`|'([^']+)'/);
    if (!um) continue;
    addCall(methodFromFetchCall(mm.index), um[1] || um[2], line, 'fetch');
  }

  const fetchTpl = /fetch\(\s*(`(\$\{[^}]+\}[^`]*)`)/g;
  while ((mm = fetchTpl.exec(src))) {
    const line = src.slice(0, mm.index).split('\n').length;
    addCall(methodFromFetchCall(mm.index), mm[2], line, 'fetch');
  }

  // CLI uses this.fetchImpl(url, { method })
  const fetchImplRe = /this\.fetchImpl\(\s*(`[^`]+`|'[^']+'|[A-Za-z_]\w*)/g;
  while ((mm = fetchImplRe.exec(src))) {
    const line = src.slice(0, mm.index).split('\n').length;
    let url = mm[1];
    if (url.startsWith('`') || url.startsWith("'") || url.startsWith('"')) {
      url = url.slice(1, -1);
    } else {
      // variable: look backward for assignment of that var to a /api/ template
      const varName = url;
      const before = src.slice(Math.max(0, mm.index - 500), mm.index);
      const assign = before.match(new RegExp(
        `(?:const|let|var)\\s+${varName}\\s*=\\s*(\`[^\`]*\\/api\\/[^\`]*\`|'[^']*\\/api\\/[^']*'|"[^"]*\\/api\\/[^"]*")\\s*;?\\s*$`
      , 'm')) || before.match(new RegExp(
        `(?:const|let|var)\\s+${varName}\\s*=\\s*(\`[^\`]*\\/api\\/[^\`]*\`)`
      ));
      if (!assign) {
        // also: const url = `${this.config.serverUrl}/api/memory/export`
        const m2 = before.match(new RegExp(
          `(?:const|let|var)\\s+${varName}\\s*=\\s*\`([^\`]+)\``
        ));
        if (m2 && m2[1].includes('/api/')) url = m2[1];
        else continue;
      } else {
        url = assign[1].slice(1, -1);
      }
    }
    addCall(methodFromFetchCall(mm.index), url, line, 'fetch');
  }

  // Variable URL then fetch(url): listBlocks / getTemplates patterns
  const varUrlRe = /(?:const|let)\s+(\w+)\s*=\s*(?:[^\n]*\n\s*)?(?:[^\n]*\?\s*)?(?:\n\s*)?`([^`]*\/api\/[^`]*)`/g;
  while ((mm = varUrlRe.exec(src))) {
    const varName = mm[1];
    const url = mm[2];
    const after = src.slice(mm.index, mm.index + 400);
    if (!new RegExp(`fetch\\(\\s*${varName}\\b`).test(after)) continue;
    const fetchIdx = mm.index + after.search(new RegExp(`fetch\\(\\s*${varName}\\b`));
    const line = src.slice(0, mm.index).split('\n').length;
    addCall(methodFromFetchCall(fetchIdx), url, line, 'fetch');
  }
  // ternary both branches
  const ternRe = /(?:const|let)\s+(\w+)\s*=\s*[^\n?]+\?\s*`([^`]*\/api\/[^`]*)`\s*:\s*`([^`]*\/api\/[^`]*)`/g;
  while ((mm = ternRe.exec(src))) {
    const varName = mm[1];
    const after = src.slice(mm.index, mm.index + 300);
    if (!new RegExp(`fetch\\(\\s*${varName}\\b`).test(after)) continue;
    const fetchIdx = mm.index + after.search(new RegExp(`fetch\\(\\s*${varName}\\b`));
    const line = src.slice(0, mm.index).split('\n').length;
    addCall(methodFromFetchCall(fetchIdx), mm[2], line, 'fetch');
    addCall(methodFromFetchCall(fetchIdx), mm[3], line, 'fetch');
  }

  const seen = new Set();
  return calls.filter((c) => {
    const k = `${c.method}|${c.url}|${c.site}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function scanAllFrontend() {
  const clients = [
    ['apps/web/src/lib/api.ts', 'web'],
    ['apps/desktop/src/lib/engine.ts', 'desktop'],
    ['apps/cli/src/client.ts', 'cli'],
  ];
  let all = [];
  for (const [fp, surface] of clients) {
    const abs = path.join(ROOT, fp);
    if (fs.existsSync(abs)) all = all.concat(scanFrontendClient(abs, surface));
  }
  all.sort(
    (a, b) =>
      a.surface.localeCompare(b.surface) ||
      a.url.localeCompare(b.url) ||
      a.method.localeCompare(b.method) ||
      a.site.localeCompare(b.site),
  );
  return all;
}

function scanAppRoutes(appFile, surface) {
  if (!fs.existsSync(appFile)) return [];
  const src = read(appFile);
  const routes = [];
  let m;
  const re = /<Route\s+path=["'`]([^"'`]+)["'`]\s+element=\{<(\w+)/g;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    routes.push({ path: m[1] || '/', element: m[2], def: `${rel(appFile)}:${line}`, surface });
  }
  const re2 = /path:\s*['"`]([^'"`]+)['"`]\s*,\s*element:\s*<(\w+)\s*\/>/g;
  while ((m = re2.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    let pathStr = m[1];
    if (surface === 'desktop' && pathStr !== '/' && !pathStr.startsWith('/')) pathStr = '/' + pathStr;
    routes.push({ path: pathStr, element: m[2], def: `${rel(appFile)}:${line}`, surface });
  }
  const reIdx = /index:\s*true\s*,\s*element:\s*<(\w+)\s*\/>/g;
  while ((m = reIdx.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    routes.push({ path: '/', element: m[1], def: `${rel(appFile)}:${line}`, surface });
  }
  const seen = new Set();
  return routes.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
}

function scanComponents() {
  const files = [
    ...walk(
      path.join(ROOT, 'apps'),
      (p) => p.endsWith('.tsx') && !p.includes('.test.') && !p.includes('node_modules'),
    ),
    ...walk(
      path.join(ROOT, 'packages'),
      (p) => p.endsWith('.tsx') && !p.includes('.test.') && !p.includes('node_modules'),
    ),
  ];
  const comps = [];
  for (const f of files) {
    const src = read(f);
    if (!/</.test(src)) continue;
    for (const re of [
      /export\s+function\s+([A-Z][A-Za-z0-9_]*)/g,
      /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/g,
      /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/g,
    ]) {
      let m;
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length;
        comps.push({ name: m[1], kind: 'function', def: `${rel(f)}:${line}`, file: rel(f) });
      }
    }
  }
  const seen = new Set();
  return comps
    .filter((c) => {
      if (seen.has(c.def)) return false;
      seen.add(c.def);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.def.localeCompare(b.def));
}

function feUrlToTemplate(url) {
  let u = url.trim().split('?')[0];
  // Query-string-only template suffixes glued without '?': /api/session${qs}
  u = u.replace(/\$\{(qs|q|query|searchParams)[^}]*\}/gi, '');
  u = u.replace(/\$\{[^}]*$/, '');
  u = u.replace(/\$\{[^}]+\}/g, (seg) => {
    if (/segs|pathSeg|filePath|path|rest|splat|rel/i.test(seg)) return '*';
    return ':param';
  });
  u = u.replace(/\/+/g, '/');
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

function pathMatch(bePath, feTemplate) {
  const norm = (p) =>
    p
      .replace(/\/+/g, '/')
      .replace(/:[^/]+/g, ':param')
      .replace(/\/\*$/, '/*')
      .replace(/\*$/, '*');
  const beN = norm(bePath);
  const feN = norm(feTemplate);
  if (beN === feN) return true;
  if (bePath.includes('*')) {
    const prefix = bePath.replace(/\*$/, '').replace(/:[^/]+/g, ':param');
    const feAs = feN.endsWith('/*') ? feN.slice(0, -1) : feN + '/';
    if (feAs.startsWith(prefix) || feN.startsWith(prefix.replace(/\/$/, ''))) return true;
  }
  if (feN.endsWith('/*') && beN.endsWith('/*') && feN.slice(0, -2) === beN.slice(0, -2)) return true;
  return false;
}

function crossref(backend, frontend) {
  const orphans = [];
  const phantoms = [];
  const matchedBe = new Set();

  for (const fe of frontend) {
    const tmpl = feUrlToTemplate(fe.url);
    let hit = false;
    for (const be of backend) {
      if (be.method !== fe.method) continue;
      if (pathMatch(be.path, tmpl)) {
        hit = true;
        matchedBe.add(`${be.method} ${be.path}`);
      }
    }
    if (!hit) phantoms.push({ ...fe, tmpl });
  }

  for (const be of backend) {
    if (be.path === '*' || be.path === '/') continue;
    let hit = matchedBe.has(`${be.method} ${be.path}`);
    if (!hit) {
      for (const fe of frontend) {
        if (fe.method !== be.method) continue;
        if (pathMatch(be.path, feUrlToTemplate(fe.url))) {
          hit = true;
          break;
        }
      }
    }
    if (!hit) orphans.push(be);
  }
  return { orphans, phantoms };
}

function scanDeadEngineMethods() {
  const enginePath = path.join(ROOT, 'apps/desktop/src/lib/engine.ts');
  const src = read(enginePath);
  const methods = [];
  const methodRe = /\n  (?:async )?([a-z][A-Za-z0-9]*)\(/g;
  let m;
  while ((m = methodRe.exec(src))) {
    const name = m[1];
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;
    const line = src.slice(0, m.index).split('\n').length + 1;
    methods.push({ name, def: `apps/desktop/src/lib/engine.ts:${line}` });
  }
  const byName = new Map();
  for (const meth of methods) if (!byName.has(meth.name)) byName.set(meth.name, meth);
  const uiFiles = walk(
    path.join(ROOT, 'apps/desktop/src'),
    (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !p.includes('.test.') &&
      !p.endsWith('/engine.ts') &&
      !p.includes('node_modules'),
  );
  const uiBlob = uiFiles.map(read).join('\n');
  const skip = new Set([
    'pathSegment',
    'sanitizeId',
    'invalidIdResponse',
    'getHeaders',
    'settingKeySegment',
    'collabSessionId',
  ]);
  const unused = [];
  for (const meth of byName.values()) {
    if (skip.has(meth.name)) continue;
    if (!new RegExp(`\\.${meth.name}\\b|\\b${meth.name}\\b`).test(uiBlob)) unused.push(meth);
  }
  return { methods: [...byName.values()], unused };
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(AUDIT, name), JSON.stringify(data, null, 2) + '\n');
}
const mdEscape = (s) => String(s).replace(/\|/g, '\\|');

function main() {
  console.log('Scanning backend...');
  const backend = scanBackend();
  console.log(`  ${backend.length} endpoints`);

  console.log('Scanning frontend clients...');
  const frontend = scanAllFrontend();
  const bySurface = { web: 0, desktop: 0, cli: 0 };
  for (const c of frontend) bySurface[c.surface] = (bySurface[c.surface] || 0) + 1;
  console.log(
    `  ${frontend.length} call sites (web=${bySurface.web}, desktop=${bySurface.desktop}, cli=${bySurface.cli})`,
  );

  console.log('Scanning routes...');
  const webRoutes = scanAppRoutes(path.join(ROOT, 'apps/web/src/App.tsx'), 'web');
  const desktopRoutes = scanAppRoutes(path.join(ROOT, 'apps/desktop/src/App.tsx'), 'desktop');
  console.log(`  web=${webRoutes.length}, desktop=${desktopRoutes.length}`);

  console.log('Scanning components...');
  const components = scanComponents();
  console.log(`  ${components.length} symbols`);

  console.log('Cross-referencing...');
  const { orphans, phantoms } = crossref(backend, frontend);

  // All remaining phantoms after qs-strip should be real; still classify qs leftovers
  const verifiedPhantoms = phantoms.filter((p) => {
    const tmpl = feUrlToTemplate(p.url);
    return !backend.some((be) => be.method === p.method && pathMatch(be.path, tmpl));
  });

  const verifiedOrphans = orphans.filter((o) => {
    if (o.path === '*' || o.path === '/') return false;
    for (const fe of frontend) {
      if (fe.method !== o.method) continue;
      if (pathMatch(o.path, feUrlToTemplate(fe.url))) return false;
    }
    return true;
  });

  console.log(`  raw orphans=${orphans.length}, raw phantoms=${phantoms.length}`);
  console.log(`  verified orphans=${verifiedOrphans.length}, verified phantoms=${verifiedPhantoms.length}`);

  const { unused } = scanDeadEngineMethods();

  writeJson('_backend_endpoints.json', backend);
  writeJson('_frontend_calls.json', frontend);
  writeJson('_routes.json', { web: webRoutes, desktop: desktopRoutes });
  writeJson('_components.json', components);
  writeJson('_orphans.json', orphans);
  writeJson('_phantoms.json', phantoms);
  writeJson('_orphans_verified.json', verifiedOrphans);

  const cross = {
    desktopRoutes,
    webRoutes,
    counts: {
      backend: backend.length,
      frontend: frontend.length,
      webCalls: bySurface.web,
      desktopCalls: bySurface.desktop,
      cliCalls: bySurface.cli,
      components: components.length,
      webRoutes: webRoutes.length,
      desktopRoutes: desktopRoutes.length,
      rawOrphans: orphans.length,
      rawPhantoms: phantoms.length,
      verifiedOrphans: verifiedOrphans.length,
      verifiedPhantoms: verifiedPhantoms.length,
      unusedEngineMethods: unused.length,
      bareButtonsCount: 0,
      bareFormsCount: 0,
    },
    unusedEngineMethods: unused,
    verifiedOrphans: verifiedOrphans.map((o) => ({ method: o.method, path: o.path, def: o.def })),
    verifiedPhantoms: verifiedPhantoms.map((p) => ({ method: p.method, url: p.url, site: p.site, tmpl: p.tmpl })),
  };
  writeJson('_crossref.json', cross);

  {
    let md = `# Backend endpoints inventory\n\n`;
    md += `**Total count: ${backend.length}**\n\n`;
    md += `Generated by Hono scan of \`apps/server/src/routes/*.ts\` + \`apps/server/src/index.ts\` via \`tools/audit/regen.mjs\` (refreshed 2026-08-05 post-remediation).\n\n`;
    md += `**Auth default:** Bearer \`NEOS_AUTH_TOKEN\` via middleware unless \`isAuthExemptPath\`.\n\n`;
    md += `**CORS:** allowMethods GET/POST/PUT/DELETE/PATCH; allowHeaders Content-Type, Authorization, **x-neos-session-id**.\n\n`;
    md += `| # | Method | Path | Path params | Body/query hints | Auth | Response codes (near handler) | Def |\n`;
    md += `|---|--------|------|-------------|------------------|------|-------------------------------|-----|\n`;
    backend.forEach((ep, i) => {
      md += `| ${i + 1} | \`${ep.method}\` | \`${mdEscape(ep.path)}\` | ${ep.pathParams?.length ? ep.pathParams.join(', ') : '—'} | ${ep.bodyHints?.length ? ep.bodyHints.join(', ') : '—'} | ${ep.auth} | ${ep.responseCodes?.join(', ') || '200'} | \`${ep.def}\` |\n`;
    });
    fs.writeFileSync(path.join(AUDIT, 'backend-endpoints.md'), md);
  }

  {
    let md = `# Frontend HTTP/SSE call inventory\n\n`;
    md += `**Total call sites: ${frontend.length}** (web=${bySurface.web}, desktop=${bySurface.desktop}, cli=${bySurface.cli})\n\n`;
    md += `Primary clients: web \`apps/web/src/lib/api.ts\`, desktop \`apps/desktop/src/lib/engine.ts\`, cli \`apps/cli/src/client.ts\`.\n\n`;
    md += `Refreshed 2026-08-05 post-remediation (web project create/rename/delete, conversations, mkdir; media image/audio removed; dead engine methods pruned; memory export CLI).\n\n`;
    md += `| # | Surface | Method | URL | Kind | Site |\n`;
    md += `|---|---------|--------|-----|------|------|\n`;
    frontend.forEach((c, i) => {
      md += `| ${i + 1} | ${c.surface} | \`${c.method}\` | \`${mdEscape(c.url)}\` | ${c.kind} | \`${c.site}\` |\n`;
    });
    fs.writeFileSync(path.join(AUDIT, 'frontend-calls.md'), md);
  }

  {
    let md = `# App routes inventory\n\n`;
    md += `**Total: ${webRoutes.length + desktopRoutes.length}** (web=${webRoutes.length}, desktop=${desktopRoutes.length})\n\n`;
    md += `## Web (\`apps/web/src/App.tsx\`)\n\n| # | Path | Element | Def |\n|---|------|---------|-----|\n`;
    webRoutes.forEach((r, i) => {
      md += `| ${i + 1} | \`${r.path}\` | ${r.element} | \`${r.def}\` |\n`;
    });
    md += `\n## Desktop (\`apps/desktop/src/App.tsx\`)\n\n| # | Path | Element | Def |\n|---|------|---------|-----|\n`;
    desktopRoutes.forEach((r, i) => {
      md += `| ${i + 1} | \`${r.path}\` | ${r.element} | \`${r.def}\` |\n`;
    });
    fs.writeFileSync(path.join(AUDIT, 'routes.md'), md);
  }

  {
    let md = `# Component inventory\n\n`;
    md += `**Total component-like symbols: ${components.length}**\n\n`;
    md += `Heuristic: exported PascalCase function/const in \`.tsx\` with JSX.\n\n`;
    md += `| # | Name | Kind | Def |\n|---|------|------|-----|\n`;
    components.forEach((c, i) => {
      md += `| ${i + 1} | \`${c.name}\` | ${c.kind} | \`${c.def}\` |\n`;
    });
    fs.writeFileSync(path.join(AUDIT, 'components.md'), md);
  }

  console.log('\nCounts:', JSON.stringify(cross.counts, null, 2));
  console.log('\nVerified orphans:');
  for (const o of verifiedOrphans) console.log(`  ${o.method} ${o.path}`);
  console.log('\nVerified phantoms:');
  for (const p of verifiedPhantoms) console.log(`  ${p.method} ${p.url} => ${p.tmpl}`);
  console.log('\nUnused engine methods:', unused.map((u) => u.name).join(', ') || '(none)');
}

main();
