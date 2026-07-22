import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from './workflows.js';

describe('verifyWebhookSignature', () => {
  const secret = 'test-webhook-secret-32bytes-long!!';
  const body = JSON.stringify({ hello: 'world' });

  it('accepts valid sha256 hmac', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, `sha256=${sig}`)).toBe(true);
  });

  it('rejects wrong signature', () => {
    expect(verifyWebhookSignature(secret, body, 'sha256=deadbeef')).toBe(false);
  });

  it('rejects missing algo prefix', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, sig)).toBe(false);
  });

  it('rejects tampered body', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body + 'x', `sha256=${sig}`)).toBe(false);
  });

  it('accepts openssl-compatible signature for empty JSON body', () => {
    // Matches desktop hmacSha256Hex / Test fire path
    const emptyBody = '{}';
    const sig = createHmac('sha256', 'test-webhook-secret').update(emptyBody).digest('hex');
    expect(sig).toBe('8592f9db7794988b89f5bcd05f3a8ef74d6986828237b62f4eb5b02aea0b076f');
    expect(verifyWebhookSignature('test-webhook-secret', emptyBody, `sha256=${sig}`)).toBe(true);
  });

  it('rejects wrong prefix casing or missing sha256=', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, `SHA256=${sig}`)).toBe(false);
    expect(verifyWebhookSignature(secret, body, `sha256:${sig}`)).toBe(false);
  });

  it('trims surrounding whitespace on the signature header', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, `  sha256=${sig}  `)).toBe(true);
    expect(verifyWebhookSignature(secret, body, `sha256=  ${sig}`)).toBe(true);
  });

  it('trims secret padding and rejects blank secret', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(`  ${secret}  `, body, `sha256=${sig}`)).toBe(true);
    expect(verifyWebhookSignature('   ', body, `sha256=${sig}`)).toBe(false);
  });
});
