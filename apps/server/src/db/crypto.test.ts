import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncrypted, isSensitiveKey } from './crypto.js';

describe('crypto helpers', () => {
  it('detects sensitive keys', () => {
    expect(isSensitiveKey('apiKey.anthropic')).toBe(true);
    expect(isSensitiveKey('apiKey.openai')).toBe(true);
    expect(isSensitiveKey('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSensitiveKey('GOOGLE_API_KEY')).toBe(true);
    expect(isSensitiveKey('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveKey('TAVILY_API_KEY')).toBe(true);
    expect(isSensitiveKey('SLACK_BOT_TOKEN')).toBe(true);
    expect(isSensitiveKey('DISCORD_WEBHOOK_URL')).toBe(true);
    expect(isSensitiveKey('KIS_APP_KEY')).toBe(true);
    expect(isSensitiveKey('KIS_APP_SECRET')).toBe(true);
    expect(isSensitiveKey('VERCEL_API_TOKEN')).toBe(true);
    expect(isSensitiveKey('CLOUDFLARE_API_TOKEN')).toBe(true);
    expect(isSensitiveKey('CLOUDFLARE_ACCOUNT_ID')).toBe(true);
    expect(isSensitiveKey('theme')).toBe(false);
    expect(isSensitiveKey('OPENAI_BASE_URL')).toBe(false);
    expect(isSensitiveKey('apiKeyNotPrefix')).toBe(false);
    expect(isSensitiveKey('  ANTHROPIC_API_KEY  ')).toBe(true);
    expect(isSensitiveKey('   ')).toBe(false);
  });

  it('detects encrypted payload shape', () => {
    const enc = encrypt('secret-value');
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted('plaintext')).toBe(false);
    expect(isEncrypted('aa:bb:cc')).toBe(false);
    expect(isEncrypted('')).toBe(false);
    expect(isEncrypted('   ')).toBe(false);
  });

  it('round-trips encrypt/decrypt', () => {
    const plain = 'sk-test-key-12345';
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('round-trips unicode and empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
    expect(decrypt(encrypt('한글🔑'))).toBe('한글🔑');
  });

  it('throws on tampered ciphertext', () => {
    const enc = encrypt('secret');
    const [iv, tag, data] = enc.split(':');
    const tampered = `${iv}:${tag}:${data!.slice(0, -2)}ff`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects invalid encrypted payloads on decrypt', () => {
    expect(() => decrypt('not-encrypted')).toThrow(/Invalid encrypted/i);
    expect(() => decrypt('   ')).toThrow(/Invalid encrypted/i);
    expect(() => decrypt('')).toThrow(/Invalid encrypted/i);
  });

  it('coerces non-string encrypt input to string', () => {
    expect(decrypt(encrypt(42 as never))).toBe('42');
  });
});
