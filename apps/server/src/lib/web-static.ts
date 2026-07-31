/**
 * Resolve optional browser UI dist for static serving (Task 12).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveWebDist(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { cwd?: string; moduleDir?: string },
): string | null {
  const raw = env.NEOS_WEB_DIST;
  if (typeof raw === 'string' && !/[\0\r\n]/.test(raw) && raw.trim()) {
    const abs = path.resolve(raw.trim());
    if (fs.existsSync(path.join(abs, 'index.html'))) return abs;
    return null;
  }
  const cwd = opts?.cwd ?? process.cwd();
  let moduleDir = opts?.moduleDir;
  if (!moduleDir) {
    try {
      moduleDir = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      moduleDir = cwd;
    }
  }
  const candidates = [
    path.resolve(moduleDir, '../../web/dist'),
    path.resolve(cwd, 'apps/web/dist'),
    path.resolve(cwd, '../web/dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}
