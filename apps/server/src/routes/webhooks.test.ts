import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import { webhookRateLimiter } from '../lib/rate-limit.js';
import webhooks from './webhooks.js';

const WF_NAME = `_cov_wh_route_${process.pid}`;

function cleanup() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
  webhookRateLimiter.reset();
}

beforeEach(cleanup);
afterEach(cleanup);

function makeWf() {
  return workflows.createWorkflow({
    name: WF_NAME,
    domain: 'general',
    nodes: [],
    edges: [],
  });
}

describe('webhook routes', () => {
  it('GET secret returns 404 for missing workflow', async () => {
    const res = await webhooks.request('/missing-id/secret');
    expect(res.status).toBe(404);
  });

  it('GET secret creates and returns secret + rateLimit', async () => {
    const wf = makeWf();
    const res = await webhooks.request(`/${wf.id}/secret`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: { secret: string; rateLimit: { limit: number; remaining: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.secret.length).toBeGreaterThan(20);
    expect(body.data.rateLimit.limit).toBe(60);
    // second call returns same secret
    const res2 = await webhooks.request(`/${wf.id}/secret`);
    const body2 = await res2.json() as { data: { secret: string } };
    expect(body2.data.secret).toBe(body.data.secret);
  });

  it('GET rate-limit and POST regenerate', async () => {
    const wf = makeWf();
    const first = await webhooks.request(`/${wf.id}/secret`);
    const secret1 = ((await first.json()) as { data: { secret: string } }).data.secret;

    const rl = await webhooks.request(`/${wf.id}/rate-limit`);
    expect(rl.status).toBe(200);
    const rlBody = await rl.json() as { ok: boolean; data: { remaining: number } };
    expect(rlBody.ok).toBe(true);
    expect(rlBody.data.remaining).toBeGreaterThan(0);

    const regen = await webhooks.request(`/${wf.id}/regenerate`, { method: 'POST' });
    expect(regen.status).toBe(200);
    const secret2 = ((await regen.json()) as { data: { secret: string } }).data.secret;
    expect(secret2).not.toBe(secret1);
    expect(secret2.length).toBeGreaterThan(20);
  });

  it('POST trigger rejects invalid signature with 401', async () => {
    const wf = makeWf();
    const body = JSON.stringify({ foo: 1 });
    const res = await webhooks.request(`/${wf.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neos-signature': 'sha256=00',
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/signature/i);
  });

  it('POST trigger returns 429 when rate limited', async () => {
    const wf = makeWf();
    // Exhaust limiter for this workflowId (default 60/min)
    for (let i = 0; i < 60; i++) {
      expect(webhookRateLimiter.check(wf.id)).toBe(true);
    }
    expect(webhookRateLimiter.check(wf.id)).toBe(false);

    const res = await webhooks.request(`/${wf.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(429);
  });

  it('POST trigger with valid HMAC starts run (streaming response)', async () => {
    const wf = makeWf();
    const secret = workflows.getOrCreateWebhookSecret(wf.id);
    const body = JSON.stringify({ ping: true });
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const res = await webhooks.request(`/${wf.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neos-signature': `sha256=${sig}`,
      },
      body,
    });
    // Stream response — success path returns 200 with SSE body
    expect(res.status).toBe(200);
    // allow stream to finish
    await res.text().catch(() => '');
    const runs = workflows.listRuns(wf.id, 5);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]?.status === 'completed' || runs[0]?.status === 'failed' || runs[0]?.status === 'running').toBe(true);
  });
});
