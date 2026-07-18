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
});
