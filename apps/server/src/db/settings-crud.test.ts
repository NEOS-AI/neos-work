import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import {
  deleteSetting,
  getAllSettings,
  getSetting,
  migrateEncryption,
  setSetting,
} from './settings.js';
import { encrypt, isEncrypted } from './crypto.js';

const KEYS = [
  'theme',
  'apiKey.anthropic',
  'ANTHROPIC_API_KEY',
  'defaults.provider',
  `cov.settings.crud.${process.pid}`,
];

afterEach(() => {
  for (const k of KEYS) {
    try {
      deleteSetting(k);
    } catch {
      /* ignore */
    }
  }
});

describe('settings CRUD + encryption migration', () => {
  it('setSetting/getSetting round-trip for plain keys', () => {
    setSetting('theme', 'dark');
    expect(getSetting('theme')).toBe('dark');
    expect(getSetting('missing-key-xyz')).toBeUndefined();
  });

  it('trims keys on get/set/delete; blank key is no-op', () => {
    const key = `cov.settings.crud.${process.pid}`;
    setSetting(`  ${key}  `, 'v1');
    expect(getSetting(`  ${key}  `)).toBe('v1');
    expect(getSetting('   ')).toBeUndefined();
    setSetting('   ', 'ignored');
    expect(deleteSetting('   ')).toBe(false);
    expect(deleteSetting(`  ${key}  `)).toBe(true);
  });

  it('encrypts sensitive keys at rest and decrypts on read', () => {
    setSetting('apiKey.anthropic', 'sk-ant-secret');
    const row = getDb()
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get('apiKey.anthropic') as { value: string };
    expect(isEncrypted(row.value)).toBe(true);
    expect(row.value).not.toContain('sk-ant-secret');
    expect(getSetting('apiKey.anthropic')).toBe('sk-ant-secret');
  });

  it('trims sensitive values on write', () => {
    setSetting('apiKey.anthropic', '  sk-pad-secret  ');
    expect(getSetting('apiKey.anthropic')).toBe('sk-pad-secret');
    // Non-sensitive values keep intentional padding
    setSetting('theme', '  dark  ');
    expect(getSetting('theme')).toBe('  dark  ');
  });

  it('getAllSettings decrypts sensitive values', () => {
    setSetting('theme', 'light');
    setSetting('apiKey.anthropic', 'sk-all');
    const all = getAllSettings();
    expect(all.theme).toBe('light');
    expect(all['apiKey.anthropic']).toBe('sk-all');
  });

  it('deleteSetting returns whether a row was removed', () => {
    setSetting('theme', 'x');
    expect(deleteSetting('theme')).toBe(true);
    expect(deleteSetting('theme')).toBe(false);
    expect(getSetting('theme')).toBeUndefined();
  });

  it('migrateEncryption encrypts plaintext sensitive rows', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('ANTHROPIC_API_KEY', 'plaintext-legacy-key');

    // Confirm stored plaintext before migration
    const before = db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get('ANTHROPIC_API_KEY') as { value: string };
    expect(isEncrypted(before.value)).toBe(false);

    migrateEncryption();

    const after = db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get('ANTHROPIC_API_KEY') as { value: string };
    expect(isEncrypted(after.value)).toBe(true);
    expect(getSetting('ANTHROPIC_API_KEY')).toBe('plaintext-legacy-key');
  });

  it('migrateEncryption skips already-encrypted and empty values', () => {
    const already = encrypt('already');
    const db = getDb();
    db.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('apiKey.anthropic', already);
    db.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run('ANTHROPIC_API_KEY', '');

    migrateEncryption();

    const row = db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get('apiKey.anthropic') as { value: string };
    expect(row.value).toBe(already);
    expect(getSetting('apiKey.anthropic')).toBe('already');
  });

  it('overwrites existing setting on conflict', () => {
    setSetting('theme', 'a');
    setSetting('theme', 'b');
    expect(getSetting('theme')).toBe('b');
  });
});
