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

function safeSettingKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const k = raw.trim();
  if (!k || k.length > 200) return '';
  return k;
}

export function getSetting(key: string): string | undefined {
  const k = safeSettingKey(key);
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
  // Control-char secrets are unusable in headers/env — treat as unset
  if (/[\0\r\n]/.test(value)) return undefined;
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

/** Cap persisted setting values (align with settings route — 1 MiB). */
export const SETTING_VALUE_MAX_CHARS = 1 * 1024 * 1024;

export function setSetting(key: string, value: string): void {
  if (typeof key === 'string' && /[\0\r\n]/.test(key)) {
    throw new Error('setting key contains invalid control characters');
  }
  const k = safeSettingKey(key);
  if (!k) {
    if (typeof key === 'string' && key.trim().length > 200) {
      throw new Error('setting key exceeds max length (200)');
    }
    return;
  }
  const db = getDb();
  // Trim secrets on write so `"  sk  "` never persists padded (align with getSecretSetting).
  // Empty secrets stay as plain "" (encrypting empty breaks isEncrypted shape / decrypt path).
  const raw = typeof value === 'string' ? value : String(value ?? '');
  // Sensitive values must not contain control chars (header/env hygiene; check before trim)
  if (isSensitiveKey(k) && /[\0\r\n]/.test(raw)) {
    throw new Error('setting value contains invalid control characters');
  }
  const normalized = isSensitiveKey(k) ? raw.trim() : raw;
  if (normalized.length > SETTING_VALUE_MAX_CHARS) {
    throw new Error(`setting value exceeds max size (${SETTING_VALUE_MAX_CHARS} characters)`);
  }
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
  if (typeof url !== 'string') return false;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(url)) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2_048) return false;
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

  // Settings UI defaults → agent adapter selection (plan multi-LLM).
  // getSecretSetting already drops control-char values; still normalize case/trim.
  const defaultProviderRaw = getSecretSetting('defaults.provider');
  const defaultProvider =
    defaultProviderRaw && !/[\0\r\n]/.test(defaultProviderRaw)
      ? defaultProviderRaw.trim().toLowerCase()
      : undefined;
  if (defaultProvider && !result.llmProvider) {
    result.llmProvider = defaultProvider;
  }
  const defaultModelRaw = getSecretSetting('defaults.model');
  const defaultModel =
    defaultModelRaw && !/[\0\r\n]/.test(defaultModelRaw)
      ? defaultModelRaw.trim()
      : undefined;
  if (defaultModel && !result.model) {
    result.model = defaultModel;
  }

  if (runtime?.serverUrl) {
    // Only inject http(s) callback URLs (matches node safeServerUrl defense-in-depth)
    // isSafeHttpBaseUrl rejects control chars before trim
    if (typeof runtime.serverUrl === 'string' && isSafeHttpBaseUrl(runtime.serverUrl)) {
      result.SERVER_URL = runtime.serverUrl.trim().replace(/\/+$/, '');
    }
  }
  if (runtime?.authToken && typeof runtime.authToken === 'string') {
    // Control-char / overlong tokens dropped (header hygiene)
    if (!/[\0\r\n]/.test(runtime.authToken) && runtime.authToken.length <= 8_192) {
      const token = runtime.authToken.trim();
      if (token) {
        result.SERVER_TOKEN = token;
        result.AUTH_TOKEN = token;
      }
    }
  }
  return result;
}

export function deleteSetting(key: string): boolean {
  const k = safeSettingKey(key);
  if (!k) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM setting WHERE key = ?').run(k);
  return result.changes > 0;
}
