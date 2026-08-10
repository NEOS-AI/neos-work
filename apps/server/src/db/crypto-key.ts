/**
 * Pluggable encryption master-key resolution for sensitive settings (AES-256-GCM).
 *
 * Priority (NEOS_SECRETS_KEY_BACKEND=auto, default):
 *   1. NEOS_MASTER_KEY env (32-byte hex/base64, or any string → SHA-256)
 *   2. OS keychain (keytar / OsKeychain) when available
 *   3. File keychain under data dir (or injected keychain)
 *   4. Legacy machine-derived key (hostname:homedir:neos-work-v1) for back-compat
 *
 * Backends: auto | env | os | file | legacy
 */

import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { hostname, homedir } from 'node:os';
import { FileKeychain, tryCreateOsKeychain, type Keychain } from './keychain.js';

export type SecretsKeySource = 'env' | 'os' | 'keychain' | 'file' | 'legacy';
export type SecretsKeyBackend = 'auto' | 'env' | 'os' | 'file' | 'legacy';

export type ResolvedEncryptionKey = {
  key: Buffer;
  source: SecretsKeySource;
};

export type ResolveEncryptionKeyOptions = {
  /** Defaults to process.env */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional file/memory keychain. When omitted and backend needs file storage,
   * uses FileKeychain under resolveDataDir() (NEOS_DATA_DIR / ~/.neos-work).
   * Pass null to skip file/memory keychain entirely.
   */
  keychain?: Keychain | null;
  /**
   * Optional OS keychain. When undefined, tryCreateOsKeychain() is used.
   * Pass null to skip OS keyring (tests).
   */
  osKeychain?: Keychain | null;
  /**
   * Force backend; else read NEOS_SECRETS_KEY_BACKEND (default auto).
   */
  backend?: SecretsKeyBackend;
  /**
   * When true and keychain has no key, generate 32 random bytes and store.
   * Default: true for backend=file|os; false for backend=auto (preserve legacy installs).
   */
  autoCreate?: boolean;
};

/** Hash arbitrary material to a 32-byte AES-256 key. */
export function hashToKey(material: string): Buffer {
  return createHash('sha256').update(material, 'utf8').digest();
}

/**
 * Parse operator-supplied master key material:
 * - 64 hex chars → 32 raw bytes
 * - base64 decoding to exactly 32 bytes
 * - otherwise SHA-256(material)
 */
export function materialToKey(material: string): Buffer {
  const s = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, 'hex');
  }
  try {
    const b64 = Buffer.from(s, 'base64');
    // Accept only if round-trip is plausible and length is 32
    if (b64.length === 32 && b64.toString('base64').replace(/=+$/, '') === s.replace(/=+$/, '')) {
      return b64;
    }
  } catch {
    // fall through
  }
  return hashToKey(s);
}

/** Pre-v0.23 machine-derived key (back-compat). */
export function deriveLegacyKey(): Buffer {
  return createHash('sha256')
    .update(`${hostname()}:${homedir()}:neos-work-v1`)
    .digest();
}

function normalizeBackend(raw: string | undefined): SecretsKeyBackend {
  const v = (raw ?? 'auto').trim().toLowerCase();
  if (v === 'env' || v === 'os' || v === 'file' || v === 'legacy' || v === 'auto') return v;
  return 'auto';
}

function readEnvMasterKey(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.NEOS_MASTER_KEY;
  if (typeof raw !== 'string') return null;
  if (/[\0\r\n]/.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return materialToKey(trimmed);
}

function sourceForKeychain(kc: Keychain): SecretsKeySource {
  if (kc.kind === 'file') return 'file';
  if (kc.kind === 'os') return 'os';
  return 'keychain';
}

/** Same rules as schema.resolveDbDir, but from an explicit env bag (tests). */
function resolveDataDir(env: NodeJS.ProcessEnv): string {
  const raw = env.NEOS_DATA_DIR;
  if (typeof raw === 'string' && !/[\0\r\n]/.test(raw)) {
    const trimmed = raw.trim();
    if (trimmed) return path.resolve(trimmed);
  }
  return path.join(homedir(), '.neos-work');
}

function defaultFileKeychain(env: NodeJS.ProcessEnv): FileKeychain {
  return new FileKeychain(resolveDataDir(env));
}

/**
 * Resolve OS keychain instance from options.
 * undefined → tryCreateOsKeychain(); null → skip; instance → use.
 */
function resolveOsKeychain(options: ResolveEncryptionKeyOptions): Keychain | null {
  if (options.osKeychain === null) return null;
  if (options.osKeychain !== undefined) return options.osKeychain;
  return tryCreateOsKeychain();
}

/**
 * Try to read (and optionally auto-create) a key from a keychain.
 * Returns null when keychain is null or empty without autoCreate.
 */
function readFromKeychain(
  kc: Keychain | null,
  autoCreate: boolean,
): ResolvedEncryptionKey | null {
  if (!kc) return null;
  const existing = kc.get();
  if (existing) {
    return { key: existing, source: sourceForKeychain(kc) };
  }
  if (autoCreate) {
    const generated = randomBytes(32);
    kc.set(generated);
    return { key: generated, source: sourceForKeychain(kc) };
  }
  return null;
}

/**
 * Resolve the AES-256 master key and its source label (never log the key).
 */
export function resolveEncryptionKey(
  options: ResolveEncryptionKeyOptions = {},
): ResolvedEncryptionKey {
  const env = options.env ?? process.env;
  const backend = options.backend ?? normalizeBackend(env.NEOS_SECRETS_KEY_BACKEND);

  if (backend === 'legacy') {
    return { key: deriveLegacyKey(), source: 'legacy' };
  }

  if (backend === 'env' || backend === 'auto') {
    const fromEnv = readEnvMasterKey(env);
    if (fromEnv) {
      return { key: fromEnv, source: 'env' };
    }
    if (backend === 'env') {
      throw new Error('NEOS_MASTER_KEY required when NEOS_SECRETS_KEY_BACKEND=env');
    }
  }

  if (backend === 'os') {
    const osKc = resolveOsKeychain(options);
    if (!osKc) {
      throw new Error(
        'NEOS_SECRETS_KEY_BACKEND=os requires a usable OS keychain (install optional keytar, or inject osKeychain)',
      );
    }
    const autoCreate = options.autoCreate ?? true;
    const fromOs = readFromKeychain(osKc, autoCreate);
    if (fromOs) return fromOs;
    throw new Error(
      'NEOS_SECRETS_KEY_BACKEND=os: OS keychain has no master key and auto-create is disabled',
    );
  }

  // file or auto: OS keychain first (auto only), then file/memory keychain
  if (backend === 'file' || backend === 'auto') {
    const autoCreateDefault = backend === 'file';
    const autoCreate = options.autoCreate ?? autoCreateDefault;

    if (backend === 'auto') {
      const osKc = resolveOsKeychain(options);
      // auto never auto-creates into OS (preserve legacy installs) unless autoCreate forced
      const fromOs = readFromKeychain(osKc, autoCreate);
      if (fromOs) return fromOs;
    }

    const kc =
      options.keychain === undefined
        ? defaultFileKeychain(env)
        : options.keychain;

    const fromFile = readFromKeychain(kc, autoCreate);
    if (fromFile) return fromFile;

    if (backend === 'file') {
      throw new Error(
        'NEOS_SECRETS_KEY_BACKEND=file requires a usable keychain (set NEOS_DATA_DIR or inject keychain)',
      );
    }
  }

  return { key: deriveLegacyKey(), source: 'legacy' };
}
