/**
 * Settings CRUD operations.
 * Key-value store for app settings (API keys, defaults, preferences).
 */

import { getDb } from './schema.js';

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
    result[row.key] = row.value;
  }
  return result;
}

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

export function deleteSetting(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM setting WHERE key = ?').run(key);
  return result.changes > 0;
}
