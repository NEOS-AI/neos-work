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
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return undefined;
  const db = getDb();
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(k) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  if (isSensitiveKey(k) && isEncrypted(row.value)) {
    return decrypt(row.value);
  }
  return row.value;
}

/** Trim and treat whitespace-only values as unset (align with preflight `secret()`). */
function trimmedSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Like getSetting but trims and treats whitespace-only as unset.
 * Prefer for API keys / tokens at route boundaries.
 */
export function getSecretSetting(key: string): string | undefined {
  return trimmedSecret(getSetting(key));
}

export function setSetting(key: string, value: string): void {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return;
  const db = getDb();
  // Trim secrets on write so `"  sk  "` never persists padded (align with getSecretSetting).
  // Empty secrets stay as plain "" (encrypting empty breaks isEncrypted shape / decrypt path).
  const normalized = isSensitiveKey(k) ? value.trim() : value;
  const storedValue =
    isSensitiveKey(k) && normalized.length > 0 ? encrypt(normalized) : normalized;
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(k, storedValue);
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
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OLLAMA_BASE_URL',
  'TAVILY_API_KEY',
  'SLACK_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'KIS_APP_KEY',
  'KIS_APP_SECRET',
  'VERCEL_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
];

/**
 * Map UI setting keys → engine secret names used by workflow-engine adapters/nodes.
 * Settings page stores Anthropic/Google as apiKey.anthropic / apiKey.google.
 */
const UI_KEY_ALIASES: Array<[string, string]> = [
  ['apiKey.anthropic', 'ANTHROPIC_API_KEY'],
  ['apiKey.google', 'GOOGLE_API_KEY'],
];

/** Returns all workflow-related API secrets as a plain-text map (for server-side use only). */
export function getWorkflowSecrets(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of WORKFLOW_SECRET_KEYS) {
    const value = trimmedSecret(getSetting(key));
    if (value !== undefined) result[key] = value;
  }
  // Prefer explicit ANTHROPIC/GOOGLE keys; fall back to UI apiKey.* aliases
  for (const [uiKey, engineKey] of UI_KEY_ALIASES) {
    if (!result[engineKey]) {
      const value = trimmedSecret(getSetting(uiKey));
      if (value !== undefined) result[engineKey] = value;
    }
  }
  return result;
}

/**
 * Reject non-http(s) base URLs (plan Task 7/3 polish — light guard, not full SSRF).
 * Exported for unit tests.
 */
export function isSafeHttpBaseUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Settings bag for executeWorkflow — secrets plus runtime server URL/token
 * so Media/Deploy/Agent memory can call back into this process (plan Tasks 7–8, 1).
 * Also injects defaults.provider → llmProvider and defaults.model → model.
 */
export function getExecutionSettings(runtime?: {
  serverUrl?: string;
  authToken?: string;
}): Record<string, string> {
  const result = getWorkflowSecrets();

  // Drop unsafe custom base URLs rather than sending them to adapters
  for (const key of ['OPENAI_BASE_URL', 'OLLAMA_BASE_URL'] as const) {
    if (result[key] && !isSafeHttpBaseUrl(result[key]!)) {
      delete result[key];
    }
  }

  // Settings UI defaults → agent adapter selection (plan multi-LLM)
  const defaultProvider = getSecretSetting('defaults.provider')?.trim().toLowerCase();
  if (defaultProvider && !result.llmProvider) {
    result.llmProvider = defaultProvider;
  }
  const defaultModel = getSecretSetting('defaults.model')?.trim();
  if (defaultModel && !result.model) {
    result.model = defaultModel;
  }

  if (runtime?.serverUrl) {
    // Only inject http(s) callback URLs (matches node safeServerUrl defense-in-depth)
    const url = typeof runtime.serverUrl === 'string' ? runtime.serverUrl.trim().replace(/\/+$/, '') : '';
    if (url && isSafeHttpBaseUrl(url)) {
      result.SERVER_URL = url;
    }
  }
  if (runtime?.authToken) {
    const token = runtime.authToken.trim();
    if (token) {
      result.SERVER_TOKEN = token;
      result.AUTH_TOKEN = token;
    }
  }
  return result;
}

export function deleteSetting(key: string): boolean {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM setting WHERE key = ?').run(k);
  return result.changes > 0;
}
