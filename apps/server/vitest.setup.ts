/**
 * Isolate SQLite / data dir per vitest worker so parallel test files do not race
 * on shared settings keys in ~/.neos-work/data.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pool = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';
const dir = path.join(os.tmpdir(), `neos-server-vitest-${process.pid}-${pool}`);
fs.mkdirSync(dir, { recursive: true });
process.env.NEOS_DATA_DIR = dir;
