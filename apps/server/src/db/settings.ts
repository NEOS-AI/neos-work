/**
 * Settings CRUD operations.
 * Key-value store for app settings (API keys, defaults, preferences).
 */

import { getDb } from './schema.js';
import { encrypt, decrypt, isSensitiveKey, isEncrypted } from './crypto.js';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM setting').all() as SettingRow[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (isSensitiveKey(row.key) && isEncrypted(row.value)) {
      result[row.key] = decrypt(row.value);
    } else {
      result[row.key] = row.value;
    }
  }
  return result;
}

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  if (isSensitiveKey(key) && isEncrypted(row.value)) {
    return decrypt(row.value);
  }
  return row.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const storedValue = isSensitiveKey(key) ? encrypt(value) : value;
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, storedValue);
}

/** Migrate plaintext sensitive values to encrypted format (one-time on startup). */
export function migrateEncryption(): void {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM setting').all() as SettingRow[];
  for (const row of rows) {
    if (isSensitiveKey(row.key) && !isEncrypted(row.value) && row.value.length > 0) {
      const encrypted = encrypt(row.value);
      db.prepare('UPDATE setting SET value = ?, updated_at = datetime(\'now\') WHERE key = ?').run(encrypted, row.key);
    }
  }
}

const WORKFLOW_SECRET_KEYS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'TAVILY_API_KEY',
  'SLACK_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'KIS_APP_KEY',
  'KIS_APP_SECRET',
];

/** Returns all workflow-related API secrets as a plain-text map (for server-side use only). */
export function getWorkflowSecrets(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of WORKFLOW_SECRET_KEYS) {
    const value = getSetting(key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function deleteSetting(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM setting WHERE key = ?').run(key);
  return result.changes > 0;
}
