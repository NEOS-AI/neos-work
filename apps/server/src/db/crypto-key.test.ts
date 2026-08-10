import { createHash } from 'node:crypto';
import { hostname, homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  deriveLegacyKey,
  hashToKey,
  materialToKey,
  resolveEncryptionKey,
} from './crypto-key.js';
import { MemoryKeychain, OsKeychain, type KeytarLike } from './keychain.js';

/** Disable real OS keyring in tests (optional keytar may be present). */
const noOs = { osKeychain: null as null };

function mockKeytarWith(key: Buffer | null): KeytarLike {
  let stored: string | null = key ? key.toString('base64') : null;
  return {
    getPassword: () => stored,
    setPassword: (_s, _a, password) => {
      stored = password;
    },
  };
}

describe('hashToKey', () => {
  it('returns 32-byte SHA-256 digest', () => {
    const key = hashToKey('hello');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(key.equals(createHash('sha256').update('hello').digest())).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashToKey('a').equals(hashToKey('a'))).toBe(true);
    expect(hashToKey('a').equals(hashToKey('b'))).toBe(false);
  });
});

describe('materialToKey', () => {
  it('accepts 32-byte hex (64 hex chars)', () => {
    const hex = 'a'.repeat(64);
    const key = materialToKey(hex);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(hex, 'hex'))).toBe(true);
  });

  it('accepts 32-byte base64', () => {
    const raw = Buffer.alloc(32, 0x5a);
    const b64 = raw.toString('base64');
    expect(materialToKey(b64).equals(raw)).toBe(true);
  });

  it('hashes arbitrary strings to 32 bytes', () => {
    const key = materialToKey('not-hex-or-b64-key-material');
    expect(key.length).toBe(32);
    expect(key.equals(hashToKey('not-hex-or-b64-key-material'))).toBe(true);
  });
});

describe('deriveLegacyKey', () => {
  it('matches machine-derived hostname:homedir:neos-work-v1', () => {
    const expected = createHash('sha256')
      .update(`${hostname()}:${homedir()}:neos-work-v1`)
      .digest();
    expect(deriveLegacyKey().equals(expected)).toBe(true);
  });
});

describe('resolveEncryptionKey', () => {
  it('prefers NEOS_MASTER_KEY env (source=env)', () => {
    const hex = 'b'.repeat(64);
    const resolved = resolveEncryptionKey({
      env: { NEOS_MASTER_KEY: hex, NEOS_SECRETS_KEY_BACKEND: 'auto' },
      keychain: new MemoryKeychain(),
      ...noOs,
    });
    expect(resolved.source).toBe('env');
    expect(resolved.key.equals(Buffer.from(hex, 'hex'))).toBe(true);
  });

  it('uses injected keychain when env missing (source=keychain)', () => {
    const stored = Buffer.alloc(32, 9);
    const kc = new MemoryKeychain();
    kc.set(stored);
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      keychain: kc,
      ...noOs,
    });
    expect(resolved.source).toBe('keychain');
    expect(resolved.key.equals(stored)).toBe(true);
  });

  it('auto prefers os keychain when injected (before file/memory)', () => {
    const osKey = Buffer.alloc(32, 0xaa);
    const fileKey = Buffer.alloc(32, 0xbb);
    const os = new OsKeychain(mockKeytarWith(osKey));
    const file = new MemoryKeychain();
    file.set(fileKey);

    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      osKeychain: os,
      keychain: file,
    });
    expect(resolved.source).toBe('os');
    expect(resolved.key.equals(osKey)).toBe(true);
  });

  it('auto prefers os via MemoryKeychain kind override', () => {
    const osKey = Buffer.alloc(32, 0x11);
    const os = new MemoryKeychain('os');
    os.set(osKey);
    const file = new MemoryKeychain();
    file.set(Buffer.alloc(32, 0x22));

    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      osKeychain: os,
      keychain: file,
    });
    expect(resolved.source).toBe('os');
    expect(resolved.key.equals(osKey)).toBe(true);
  });

  it('auto falls through empty os to file keychain', () => {
    const fileKey = Buffer.alloc(32, 0x33);
    const file = new MemoryKeychain();
    file.set(fileKey);
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      osKeychain: new OsKeychain(mockKeytarWith(null)),
      keychain: file,
    });
    expect(resolved.source).toBe('keychain');
    expect(resolved.key.equals(fileKey)).toBe(true);
  });

  it('auto-creates in keychain when empty and autoCreate=true', () => {
    const kc = new MemoryKeychain();
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      keychain: kc,
      autoCreate: true,
      ...noOs,
    });
    expect(resolved.source).toBe('keychain');
    expect(resolved.key.length).toBe(32);
    expect(kc.get()!.equals(resolved.key)).toBe(true);
  });

  it('falls back to legacy when no env and empty keychain without autoCreate', () => {
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'auto' },
      keychain: new MemoryKeychain(),
      autoCreate: false,
      ...noOs,
    });
    expect(resolved.source).toBe('legacy');
    expect(resolved.key.equals(deriveLegacyKey())).toBe(true);
  });

  it('backend=legacy always uses machine-derived key', () => {
    const hex = 'c'.repeat(64);
    const kc = new MemoryKeychain();
    kc.set(Buffer.alloc(32, 1));
    const resolved = resolveEncryptionKey({
      env: { NEOS_MASTER_KEY: hex, NEOS_SECRETS_KEY_BACKEND: 'legacy' },
      keychain: kc,
    });
    expect(resolved.source).toBe('legacy');
    expect(resolved.key.equals(deriveLegacyKey())).toBe(true);
  });

  it('backend=env requires NEOS_MASTER_KEY', () => {
    expect(() =>
      resolveEncryptionKey({
        env: { NEOS_SECRETS_KEY_BACKEND: 'env' },
        keychain: new MemoryKeychain(),
      }),
    ).toThrow(/NEOS_MASTER_KEY/);
  });

  it('backend=env uses only env key', () => {
    const material = 'operator-controlled-secret';
    const resolved = resolveEncryptionKey({
      env: { NEOS_MASTER_KEY: material, NEOS_SECRETS_KEY_BACKEND: 'env' },
      keychain: new MemoryKeychain(),
    });
    expect(resolved.source).toBe('env');
    expect(resolved.key.equals(hashToKey(material))).toBe(true);
  });

  it('backend=file uses keychain and auto-creates by default', () => {
    const kc = new MemoryKeychain();
    // FileKeychain reports kind=file; Memory reports keychain — force via backend=file still uses injected kc
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'file' },
      keychain: kc,
    });
    expect(resolved.key.length).toBe(32);
    expect(kc.get()!.equals(resolved.key)).toBe(true);
    // MemoryKeychain kind → source keychain; FileKeychain would be file
    expect(['keychain', 'file']).toContain(resolved.source);
  });

  it('backend=os uses OsKeychain and auto-creates by default', () => {
    const os = new OsKeychain(mockKeytarWith(null));
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'os' },
      osKeychain: os,
    });
    expect(resolved.source).toBe('os');
    expect(resolved.key.length).toBe(32);
    expect(os.get()!.equals(resolved.key)).toBe(true);
  });

  it('backend=os throws when OS keychain unavailable', () => {
    expect(() =>
      resolveEncryptionKey({
        env: { NEOS_SECRETS_KEY_BACKEND: 'os' },
        osKeychain: null,
      }),
    ).toThrow(/OS keychain|keytar|NEOS_SECRETS_KEY_BACKEND=os/i);
  });

  it('backend=os uses existing key without regenerating', () => {
    const existing = Buffer.alloc(32, 0x77);
    const os = new OsKeychain(mockKeytarWith(existing));
    const resolved = resolveEncryptionKey({
      env: { NEOS_SECRETS_KEY_BACKEND: 'os' },
      osKeychain: os,
    });
    expect(resolved.source).toBe('os');
    expect(resolved.key.equals(existing)).toBe(true);
  });

  it('trims NEOS_MASTER_KEY and rejects control chars', () => {
    const hex = `${'d'.repeat(64)}`;
    const ok = resolveEncryptionKey({
      env: { NEOS_MASTER_KEY: `  ${hex}  `, NEOS_SECRETS_KEY_BACKEND: 'env' },
    });
    expect(ok.source).toBe('env');
    expect(ok.key.equals(Buffer.from(hex, 'hex'))).toBe(true);

    const fallback = resolveEncryptionKey({
      env: { NEOS_MASTER_KEY: 'bad\nkey', NEOS_SECRETS_KEY_BACKEND: 'auto' },
      keychain: new MemoryKeychain(),
      autoCreate: false,
      ...noOs,
    });
    expect(fallback.source).toBe('legacy');
  });
});
