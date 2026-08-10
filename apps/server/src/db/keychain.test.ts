import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileKeychain,
  MemoryKeychain,
  OS_KEYCHAIN_ACCOUNT,
  OS_KEYCHAIN_SERVICE,
  OsKeychain,
  tryCreateOsKeychain,
  type KeytarLike,
} from './keychain.js';

describe('MemoryKeychain', () => {
  it('returns null when empty', () => {
    const kc = new MemoryKeychain();
    expect(kc.get()).toBeNull();
  });

  it('stores and returns a 32-byte key', () => {
    const kc = new MemoryKeychain();
    const key = Buffer.alloc(32, 7);
    kc.set(key);
    const got = kc.get();
    expect(got).not.toBeNull();
    expect(got!.equals(key)).toBe(true);
    expect(got!.length).toBe(32);
  });

  it('rejects non-32-byte keys', () => {
    const kc = new MemoryKeychain();
    expect(() => kc.set(Buffer.alloc(16))).toThrow(/32/);
    expect(() => kc.set(Buffer.alloc(64))).toThrow(/32/);
  });

  it('kind is keychain by default', () => {
    expect(new MemoryKeychain().kind).toBe('keychain');
  });

  it('allows kind override for DI (e.g. os)', () => {
    expect(new MemoryKeychain('os').kind).toBe('os');
    expect(new MemoryKeychain('file').kind).toBe('file');
  });
});

/** In-memory keytar stand-in for OsKeychain unit tests (no native module). */
function mockKeytar(store: Map<string, string> = new Map()): KeytarLike & { store: Map<string, string> } {
  return {
    store,
    getPassword(service: string, account: string): string | null {
      return store.get(`${service}\0${account}`) ?? null;
    },
    setPassword(service: string, account: string, password: string): void {
      store.set(`${service}\0${account}`, password);
    },
  };
}

describe('OsKeychain', () => {
  it('kind is os', () => {
    expect(new OsKeychain(mockKeytar()).kind).toBe('os');
  });

  it('returns null when empty', () => {
    const kc = new OsKeychain(mockKeytar());
    expect(kc.get()).toBeNull();
  });

  it('stores key as base64 under neos-work / master-key', () => {
    const api = mockKeytar();
    const kc = new OsKeychain(api);
    const key = Buffer.alloc(32, 0xcd);
    kc.set(key);

    const stored = api.store.get(`${OS_KEYCHAIN_SERVICE}\0${OS_KEYCHAIN_ACCOUNT}`);
    expect(stored).toBe(key.toString('base64'));
    expect(kc.get()!.equals(key)).toBe(true);
  });

  it('returns null for corrupt (wrong-length) base64 payload', () => {
    const api = mockKeytar();
    api.setPassword(OS_KEYCHAIN_SERVICE, OS_KEYCHAIN_ACCOUNT, Buffer.alloc(8).toString('base64'));
    const kc = new OsKeychain(api);
    expect(kc.get()).toBeNull();
  });

  it('returns null when keytar get throws', () => {
    const kc = new OsKeychain({
      getPassword: () => {
        throw new Error('keychain locked');
      },
      setPassword: () => {},
    });
    expect(kc.get()).toBeNull();
  });

  it('set throws a clear error when keytar fails', () => {
    const kc = new OsKeychain({
      getPassword: () => null,
      setPassword: () => {
        throw new Error('denied');
      },
    });
    expect(() => kc.set(Buffer.alloc(32, 1))).toThrow(/OS keychain|keytar|denied/i);
  });

  it('rejects non-32-byte keys on set', () => {
    const kc = new OsKeychain(mockKeytar());
    expect(() => kc.set(Buffer.alloc(16))).toThrow(/32/);
  });
});

describe('tryCreateOsKeychain', () => {
  it('returns null or OsKeychain depending on optional keytar availability', () => {
    const result = tryCreateOsKeychain();
    // No hard requirement: keytar is optionalDependencies and may be absent
    // or fail native load. Factory must never throw.
    expect(result === null || result instanceof OsKeychain).toBe(true);
    if (result) {
      expect(result.kind).toBe('os');
    }
  });
});

describe('FileKeychain', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeTmp(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-file-keychain-'));
    return tmpDir;
  }

  it('returns null when master key file is missing', () => {
    const dir = makeTmp();
    const kc = new FileKeychain(dir);
    expect(kc.get()).toBeNull();
  });

  it('writes master.key under .secrets with 32 random-capable bytes', () => {
    const dir = makeTmp();
    const kc = new FileKeychain(dir);
    const key = Buffer.alloc(32, 0xab);
    kc.set(key);

    const filePath = path.join(dir, '.secrets', 'master.key');
    expect(fs.existsSync(filePath)).toBe(true);
    const onDisk = fs.readFileSync(filePath);
    expect(onDisk.equals(key)).toBe(true);

    if (process.platform !== 'win32') {
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('round-trips get after set', () => {
    const dir = makeTmp();
    const kc = new FileKeychain(dir);
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes
    kc.set(key);
    expect(kc.get()!.equals(key)).toBe(true);

    const kc2 = new FileKeychain(dir);
    expect(kc2.get()!.equals(key)).toBe(true);
  });

  it('rejects non-32-byte keys on set', () => {
    const dir = makeTmp();
    const kc = new FileKeychain(dir);
    expect(() => kc.set(Buffer.alloc(8))).toThrow(/32/);
  });

  it('returns null for corrupt (wrong-length) key file', () => {
    const dir = makeTmp();
    const secrets = path.join(dir, '.secrets');
    fs.mkdirSync(secrets, { recursive: true });
    fs.writeFileSync(path.join(secrets, 'master.key'), Buffer.alloc(10));
    const kc = new FileKeychain(dir);
    expect(kc.get()).toBeNull();
  });

  it('kind is file', () => {
    const dir = makeTmp();
    expect(new FileKeychain(dir).kind).toBe('file');
  });
});
