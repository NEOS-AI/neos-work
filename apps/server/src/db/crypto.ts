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

const SENSITIVE_PREFIXES = ['apiKey.'];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Check whether a value looks like our encrypted format (hex:hex:hex). */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  const [ivHex, tagHex, dataHex] = encoded.split(':');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}
