#!/usr/bin/env node
/**
 * tools/dev — local process lifecycle for server (+ optional desktop hint)
 * Usage: node tools/dev/dev.mjs <start|stop|status|logs|restart>
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STATE_DIR = path.join(ROOT, '.tools-dev');
const PID_FILE = path.join(STATE_DIR, 'server.pid');
const LOG_FILE = path.join(STATE_DIR, 'server.log');
const META_FILE = path.join(STATE_DIR, 'server.meta.json');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function cmdStart() {
  ensureStateDir();
  const existing = readPid();
  if (isRunning(existing)) {
    console.log(`already running pid=${existing}`);
    const meta = readMeta();
    if (meta?.port) console.log(`NEOS_PORT=${meta.port}`);
    if (meta?.token) console.log(`NEOS_AUTH_TOKEN=${meta.token}`);
    return 0;
  }

  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(
    'pnpm',
    ['--filter', '@neos-work/server', 'exec', 'tsx', 'src/index.ts'],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        NEOS_PORT: process.env.NEOS_PORT || '3000',
        NEOS_HOST: process.env.NEOS_HOST || '127.0.0.1',
      },
    },
  );
  fs.closeSync(logFd);
  child.unref();

  const pid = child.pid;
  if (!pid) {
    console.error('failed to spawn server');
    return 1;
  }
  fs.writeFileSync(PID_FILE, String(pid));
  console.log(`started pid=${pid}`);
  console.log(`logs: ${LOG_FILE}`);

  // Poll log for token (best-effort, up to ~5s)
  const deadline = Date.now() + 8_000;
  let port;
  let token;
  while (Date.now() < deadline) {
    try {
      const log = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = log.split(/\r?\n/).reverse();
      for (const line of lines) {
        if (!port && line.startsWith('NEOS_PORT=')) {
          port = Number(line.slice('NEOS_PORT='.length).trim());
        }
        if (!token && line.startsWith('NEOS_AUTH_TOKEN=')) {
          token = line.slice('NEOS_AUTH_TOKEN='.length).trim();
        }
      }
      if (port && token) break;
    } catch {
      // ignore
    }
    // brief sync wait for log lines
    const end = Date.now() + 200;
    while (Date.now() < end) { /* spin */ }
  }
  if (port || token) {
    fs.writeFileSync(
      META_FILE,
      JSON.stringify({ pid, port, token, startedAt: new Date().toISOString() }, null, 2),
    );
    if (port) console.log(`NEOS_PORT=${port}`);
    if (token) console.log(`NEOS_AUTH_TOKEN=${token}`);
  } else {
    console.log('(token not yet in logs — check tools/dev logs)');
  }
  return 0;
}

function cmdStop() {
  const pid = readPid();
  if (!isRunning(pid)) {
    console.log('not running');
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
    return 0;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`stopped pid=${pid}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
  return 0;
}

function cmdStatus() {
  const pid = readPid();
  const running = isRunning(pid);
  const meta = readMeta();
  if (running) {
    console.log(`running pid=${pid}`);
    if (meta?.port) console.log(`port=${meta.port}`);
    if (meta?.token) console.log(`token=set`);
  } else {
    console.log('stopped');
  }
  return running ? 0 : 1;
}

function cmdLogs() {
  ensureStateDir();
  if (!fs.existsSync(LOG_FILE)) {
    console.log('(no log file yet)');
    return 0;
  }
  const follow = process.argv.includes('-f') || process.argv.includes('--follow');
  if (!follow) {
    process.stdout.write(fs.readFileSync(LOG_FILE, 'utf8'));
    return 0;
  }
  // simple tail -f
  let pos = fs.statSync(LOG_FILE).size;
  const stream = () => {
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > pos) {
        const fd = fs.openSync(LOG_FILE, 'r');
        const buf = Buffer.alloc(st.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        fs.closeSync(fd);
        process.stdout.write(buf);
        pos = st.size;
      }
    } catch {
      // ignore
    }
  };
  stream();
  const t = setInterval(stream, 400);
  process.on('SIGINT', () => {
    clearInterval(t);
    process.exit(0);
  });
  return 0;
}

const cmd = process.argv[2] || 'status';
let code = 0;
switch (cmd) {
  case 'start':
    code = cmdStart();
    break;
  case 'stop':
    code = cmdStop();
    break;
  case 'restart':
    cmdStop();
    code = cmdStart();
    break;
  case 'status':
    code = cmdStatus();
    break;
  case 'logs':
    code = cmdLogs();
    break;
  default:
    console.error('usage: node tools/dev/dev.mjs <start|stop|restart|status|logs [-f]>');
    code = 2;
}
process.exit(code);
