/**
 * Encryption utilities for sensitive settings (API keys).
 * Uses AES-256-GCM with a machine-derived key.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { hostname, homedir } from 'node:os';

const ALGO = 'aes-256-gcm';

/** Derive a 256-bit key from machine-specific attributes. */
const KEY = createHash('sha256')
  .update(`${hostname()}:${homedir()}:neos-work-v1`)
  .digest();

const SENSITIVE_PREFIXES = [
  'apiKey.',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
  'SLACK_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'KIS_APP_KEY',
  'KIS_APP_SECRET',
  'VERCEL_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
];

export function isSensitiveKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  // Control-char keys are never treated as sensitive prefixes
  if (/[\0\r\n]/.test(key)) return false;
  const k = key.trim();
  if (!k || k.length > 200) return false;
  return SENSITIVE_PREFIXES.some((prefix) => k.startsWith(prefix));
}

/** Check whether a value looks like our encrypted format (hex:hex:hex). */
export function isEncrypted(value: string): boolean {
  if (typeof value !== 'string') return false;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(value)) return false;
  const v = value.trim();
  if (!v) return false;
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/.test(v);
}

/** Cap encrypted secret size (settings API key / token hygiene). */
export const ENCRYPT_PLAINTEXT_MAX_CHARS = 1 * 1024 * 1024;

export function encrypt(plaintext: string): string {
  const text = typeof plaintext === 'string' ? plaintext : String(plaintext ?? '');
  if (text.length > ENCRYPT_PLAINTEXT_MAX_CHARS) {
    throw new Error(
      `plaintext exceeds max size (${ENCRYPT_PLAINTEXT_MAX_CHARS} characters)`,
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  if (typeof encoded !== 'string' || /[\0\r\n]/.test(encoded)) {
    throw new Error('Invalid encrypted value');
  }
  const raw = encoded.trim();
  if (!raw || !isEncrypted(raw)) {
    throw new Error('Invalid encrypted value');
  }
  const [ivHex, tagHex, dataHex] = raw.split(':');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  return decipher.update(Buffer.from(dataHex!, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}
