/**
 * Spawn the NEOS Work engine and parse NEOS_PORT / NEOS_AUTH_TOKEN from stdout.
 * Used by `neos daemon start` (Task 11 residual).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface DaemonStartResult {
  port: number;
  token: string;
  pid: number;
  serverUrl: string;
}

export type SpawnFn = typeof spawn;

export interface DaemonStartOptions {
  port?: number;
  /** Absolute path to server entry (dist/index.js). */
  serverEntry?: string;
  /** Working directory for the child. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  /** Max ms to wait for token/port lines. */
  timeoutMs?: number;
  /** Called for each stdout/stderr line (tests/logging). */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** If true, do not detach; leave stdio piped (default true for parsing). */
  keepAttached?: boolean;
}

function resolveDefaultServerEntry(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@neos-work/server/package.json');
    const dir = path.dirname(pkgJson);
    const dist = path.join(dir, 'dist', 'index.js');
    if (fs.existsSync(dist)) return dist;
    // tsx fallback for monorepo dev
    const src = path.join(dir, 'src', 'index.ts');
    if (fs.existsSync(src)) return src;
  } catch {
    // ignore
  }
  // relative from apps/cli/dist or src
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../../../server/dist/index.js'),
      path.resolve(here, '../../server/dist/index.js'),
      path.resolve(here, '../../../server/src/index.ts'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } catch {
    // ignore
  }
  return null;
}

function parseMetaLine(line: string): { port?: number; token?: string } {
  const t = line.trim();
  if (t.startsWith('NEOS_PORT=')) {
    const n = Number(t.slice('NEOS_PORT='.length).trim());
    if (Number.isFinite(n) && n > 0 && n < 65536) return { port: Math.trunc(n) };
  }
  if (t.startsWith('NEOS_AUTH_TOKEN=')) {
    const token = t.slice('NEOS_AUTH_TOKEN='.length).trim();
    if (token && !/[\0\r\n]/.test(token) && token.length <= 8_192) return { token };
  }
  return {};
}

/**
 * Start the daemon process and wait until port+token are printed.
 */
export function startDaemonProcess(opts: DaemonStartOptions = {}): Promise<DaemonStartResult> {
  const entry = opts.serverEntry || resolveDefaultServerEntry();
  if (!entry) {
    return Promise.reject(
      new Error(
        'Cannot find @neos-work/server entry. Build the server (`pnpm --filter @neos-work/server build`) or pass --entry.',
      ),
    );
  }

  const port = opts.port ?? 3000;
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 20_000, 2_000), 120_000);
  const spawnFn = opts.spawnFn ?? spawn;
  const isTs = entry.endsWith('.ts');
  const command = process.execPath;
  const args = isTs
    ? ['--import', 'tsx', entry]
    : [entry];

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
    NEOS_PORT: String(port),
    PORT: String(port),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let portFound: number | undefined;
    let tokenFound: string | undefined;

    const child: ChildProcess = spawnFn(command, args, {
      cwd: opts.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        reject(err);
        return;
      }
      if (portFound != null && tokenFound) {
        // unref so CLI can exit while daemon keeps running
        try {
          child.unref();
        } catch {
          // ignore
        }
        resolve({
          port: portFound,
          token: tokenFound,
          pid: child.pid ?? 0,
          serverUrl: `http://127.0.0.1:${portFound}`,
        });
      } else {
        reject(new Error('Daemon started but did not print NEOS_PORT/NEOS_AUTH_TOKEN'));
      }
    };

    const onData = (buf: Buffer, stream: 'stdout' | 'stderr') => {
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        opts.onLine?.(line, stream);
        const meta = parseMetaLine(line);
        if (meta.port != null) portFound = meta.port;
        if (meta.token) tokenFound = meta.token;
        if (portFound != null && tokenFound) finish();
      }
    };

    child.stdout?.on('data', (b: Buffer) => onData(b, 'stdout'));
    child.stderr?.on('data', (b: Buffer) => onData(b, 'stderr'));
    child.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    child.on('exit', (code) => {
      if (!settled) {
        finish(new Error(`Daemon exited early (code ${code ?? '?'})`));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for daemon metadata (${timeoutMs}ms)`));
    }, timeoutMs);
  });
}

/** Persist CLI daemon session for later stop/status (best-effort). */
export function writeDaemonSession(
  filePath: string,
  session: { pid: number; port: number; token: string; serverUrl: string },
): void {
  const pid = Math.trunc(Number(session.pid));
  const port = Math.trunc(Number(session.port));
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('Invalid daemon pid');
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error('Invalid daemon port');
  }
  if (
    typeof session.token !== 'string'
    || !session.token
    || /[\0\r\n]/.test(session.token)
    || session.token.length > 8_192
  ) {
    throw new Error('Invalid daemon token');
  }
  if (
    typeof session.serverUrl !== 'string'
    || !session.serverUrl
    || /[\0\r\n]/.test(session.serverUrl)
    || session.serverUrl.length > 2_048
  ) {
    throw new Error('Invalid daemon serverUrl');
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify(
    {
      pid,
      port,
      token: session.token,
      serverUrl: session.serverUrl,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  // Atomic-ish write + force mode 0600 (mode in writeFileSync is create-only on some platforms)
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // ignore (windows)
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
}

export function clearDaemonSession(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function defaultDaemonSessionPath(home = process.env.HOME || process.env.USERPROFILE || ''): string {
  const base = home && !/[\0\r\n]/.test(home) ? home : path.join('/tmp');
  return path.join(base, '.neos-work', 'cli-daemon.json');
}

export function readDaemonSession(filePath: string): {
  pid: number;
  port: number;
  token: string;
  serverUrl: string;
} | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (/\0/.test(raw) || raw.length > 64_000) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    const pid = Number(j.pid);
    const port = Number(j.port);
    const token = typeof j.token === 'string' ? j.token : '';
    const serverUrl = typeof j.serverUrl === 'string' ? j.serverUrl : '';
    if (!Number.isFinite(pid) || pid <= 0) return null;
    if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
    if (!token || token.length > 8_192 || !serverUrl || serverUrl.length > 2_048) return null;
    if (/[\0\r\n]/.test(token) || /[\0\r\n]/.test(serverUrl)) return null;
    // Only allow local http(s) URLs in session (defense if file is tampered)
    try {
      const u = new URL(serverUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const host = u.hostname.toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
    } catch {
      return null;
    }
    return { pid: Math.trunc(pid), port: Math.trunc(port), token, serverUrl };
  } catch {
    return null;
  }
}

export { parseMetaLine, resolveDefaultServerEntry };
