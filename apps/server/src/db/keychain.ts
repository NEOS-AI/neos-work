/**
 * Pluggable secret storage for the AES master key material (32 raw bytes).
 *
 * - MemoryKeychain — tests / DI
 * - FileKeychain — `{NEOS_DATA_DIR}/.secrets/master.key` (mode 0600)
 * - OsKeychain — native OS keyring via optional `keytar` (service `neos-work`)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Logging source label for a keychain backend. */
export type KeychainKind = 'keychain' | 'file' | 'os';

export interface Keychain {
  readonly kind: KeychainKind;
  /** Return stored 32-byte key, or null if missing/unreadable. */
  get(): Buffer | null;
  /** Persist a 32-byte key. */
  set(key: Buffer): void;
}

/** OS keyring coordinates (keytar service / account). */
export const OS_KEYCHAIN_SERVICE = 'neos-work';
export const OS_KEYCHAIN_ACCOUNT = 'master-key';

/**
 * Minimal sync keytar surface used by OsKeychain.
 * Real keytar is Promise-based; tryCreateOsKeychain adapts it via a sync bridge.
 */
export type KeytarLike = {
  getPassword(service: string, account: string): string | null;
  setPassword(service: string, account: string, password: string): void;
};

function assertKeyLength(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('encryption master key must be exactly 32 bytes');
  }
}

/** In-memory keychain for unit tests and DI. Optional kind override for source labels. */
export class MemoryKeychain implements Keychain {
  readonly kind: KeychainKind;
  private key: Buffer | null = null;

  constructor(kind: KeychainKind = 'keychain') {
    this.kind = kind;
  }

  get(): Buffer | null {
    return this.key ? Buffer.from(this.key) : null;
  }

  set(key: Buffer): void {
    assertKeyLength(key);
    this.key = Buffer.from(key);
  }
}

/**
 * File-backed keychain: `{dataDir}/.secrets/master.key` (0600 when supported).
 * Documented as "file keychain" — not a place for plaintext API keys.
 */
export class FileKeychain implements Keychain {
  readonly kind: KeychainKind = 'file';
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, '.secrets', 'master.key');
  }

  get(): Buffer | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath);
      if (raw.length !== 32) return null;
      return raw;
    } catch {
      return null;
    }
  }

  set(key: Buffer): void {
    assertKeyLength(key);
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Write privately then chmod (mode on writeFile is umask-affected on some systems).
    fs.writeFileSync(this.filePath, key, { mode: 0o600 });
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows / restricted FS may not support chmod — best-effort.
    }
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best-effort
    }
  }
}

/**
 * Native OS keyring via keytar (or a test double).
 * Stores the 32-byte key as base64 in the password field.
 */
export class OsKeychain implements Keychain {
  readonly kind: KeychainKind = 'os';

  constructor(private readonly keytar: KeytarLike) {}

  get(): Buffer | null {
    try {
      const password = this.keytar.getPassword(OS_KEYCHAIN_SERVICE, OS_KEYCHAIN_ACCOUNT);
      if (password == null || password === '') return null;
      const raw = Buffer.from(password, 'base64');
      if (raw.length !== 32) return null;
      return raw;
    } catch {
      return null;
    }
  }

  set(key: Buffer): void {
    assertKeyLength(key);
    const b64 = key.toString('base64');
    try {
      this.keytar.setPassword(OS_KEYCHAIN_SERVICE, OS_KEYCHAIN_ACCOUNT, b64);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `OS keychain (keytar) failed to store master key (service=${OS_KEYCHAIN_SERVICE}, account=${OS_KEYCHAIN_ACCOUNT}): ${msg}`,
      );
    }
  }
}

/**
 * Bridge async keytar Promises to the sync Keychain interface using a short-lived
 * Node subprocess (startup / rare set paths only). Returns null if keytar cannot load.
 */
function tryLoadKeytarSyncAdapter(): KeytarLike | null {
  let keytarResolved: string;
  try {
    const require = createRequire(import.meta.url);
    keytarResolved = require.resolve('keytar');
    // Ensure the native module actually loads in this process (optional build may fail).
    const probe = require('keytar') as {
      getPassword?: unknown;
      setPassword?: unknown;
    };
    if (typeof probe.getPassword !== 'function' || typeof probe.setPassword !== 'function') {
      return null;
    }
  } catch {
    return null;
  }

  const run = (op: 'get' | 'set', password?: string): { ok: boolean; stdout: string; stderr: string } => {
    // Inline script keeps service/account configurable via argv.
    const script = `
      const keytar = require(${JSON.stringify(keytarResolved)});
      const op = process.argv[1];
      const service = process.argv[2];
      const account = process.argv[3];
      const password = process.argv[4] ?? '';
      (async () => {
        try {
          if (op === 'get') {
            const p = await keytar.getPassword(service, account);
            if (p != null) process.stdout.write(p);
          } else if (op === 'set') {
            await keytar.setPassword(service, account, password);
          } else {
            process.stderr.write('unknown op');
            process.exit(2);
          }
        } catch (e) {
          process.stderr.write(e && e.message ? e.message : String(e));
          process.exit(1);
        }
      })();
    `;
    const r = spawnSync(
      process.execPath,
      ['-e', script, op, OS_KEYCHAIN_SERVICE, OS_KEYCHAIN_ACCOUNT, password ?? ''],
      { encoding: 'utf8', maxBuffer: 64 * 1024 },
    );
    return {
      ok: r.status === 0,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  };

  return {
    getPassword(_service: string, _account: string): string | null {
      const r = run('get');
      if (!r.ok) return null;
      return r.stdout === '' ? null : r.stdout;
    },
    setPassword(_service: string, _account: string, password: string): void {
      const r = run('set', password);
      if (!r.ok) {
        throw new Error(r.stderr || 'keytar setPassword failed');
      }
    },
  };
}

/**
 * Attempt to construct an OsKeychain backed by optional native `keytar`.
 * Returns null when the module is missing, fails to load, or is unusable.
 * Never throws.
 */
export function tryCreateOsKeychain(): OsKeychain | null {
  try {
    const adapter = tryLoadKeytarSyncAdapter();
    if (!adapter) return null;
    return new OsKeychain(adapter);
  } catch {
    return null;
  }
}
