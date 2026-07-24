import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import {
  createWorkflow,
  getOrCreateWebhookSecret,
  regenerateWebhookSecret,
  verifyWebhookSignature,
} from './workflows.js';

const WF_NAME = `_cov_wh_db_${process.pid}`;

afterEach(() => {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
});

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

  it('accepts case-insensitive sha256 prefix; rejects missing equals form', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, `SHA256=${sig}`)).toBe(true);
    expect(verifyWebhookSignature(secret, body, `Sha256=${sig}`)).toBe(true);
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

  it('rejects non-hex signature material via constant-time path', () => {
    expect(verifyWebhookSignature(secret, body, 'sha256=not-hex!!!')).toBe(false);
  });
});

describe('getOrCreateWebhookSecret / regenerateWebhookSecret', () => {
  it('creates a secret once, reuses it, and trims workflowId', () => {
    const wf = createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const first = getOrCreateWebhookSecret(`  ${wf.id}  `);
    expect(first.length).toBe(64); // 32 bytes hex
    expect(/^[a-f0-9]+$/.test(first)).toBe(true);

    const second = getOrCreateWebhookSecret(wf.id);
    expect(second).toBe(first);
  });

  it('regenerates a new secret and trims id', () => {
    const wf = createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const original = getOrCreateWebhookSecret(wf.id);
    const rotated = regenerateWebhookSecret(`  ${wf.id}  `);
    expect(rotated).not.toBe(original);
    expect(rotated.length).toBe(64);
    expect(getOrCreateWebhookSecret(wf.id)).toBe(rotated);
  });

  it('throws for blank or missing workflow ids', () => {
    expect(() => getOrCreateWebhookSecret('   ')).toThrow(/Workflow not found/);
    expect(() => getOrCreateWebhookSecret('missing-wf-id')).toThrow(/Workflow not found/);
    expect(() => regenerateWebhookSecret('   ')).toThrow(/Workflow not found/);
    expect(() => regenerateWebhookSecret('missing-wf-id')).toThrow(/Workflow not found/);
  });
});
