import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncrypted, isSensitiveKey } from './crypto.js';

describe('crypto helpers', () => {
  it('detects sensitive keys', () => {
    expect(isSensitiveKey('apiKey.anthropic')).toBe(true);
    expect(isSensitiveKey('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSensitiveKey('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveKey('VERCEL_API_TOKEN')).toBe(true);
    expect(isSensitiveKey('CLOUDFLARE_API_TOKEN')).toBe(true);
    expect(isSensitiveKey('CLOUDFLARE_ACCOUNT_ID')).toBe(true);
    expect(isSensitiveKey('theme')).toBe(false);
    expect(isSensitiveKey('OPENAI_BASE_URL')).toBe(false);
  });

  it('detects encrypted payload shape', () => {
    const enc = encrypt('secret-value');
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted('plaintext')).toBe(false);
    expect(isEncrypted('aa:bb:cc')).toBe(false);
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
});
