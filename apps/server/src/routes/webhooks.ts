/**
 * Webhook trigger routes.
 * POST /api/webhook/:workflowId — trigger workflow via webhook with HMAC-SHA256 signature.
 * GET  /api/webhook/:workflowId/secret — get or create webhook secret
 * POST /api/webhook/:workflowId/regenerate — regenerate webhook secret
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { WorkflowSSEEvent } from '@neos-work/shared';
import { executeWorkflow } from '@neos-work/workflow-engine';
import * as db from '../db/workflows.js';
import { getWorkflowSecrets } from '../db/settings.js';
import { spawnCliAgent } from '../lib/cli-agents.js';
import { getDesignSystemContent } from '../lib/design-system-store.js';
import { webhookRateLimiter } from '../lib/rate-limit.js';

const webhooks = new Hono();

function checkRateLimit(workflowId: string): boolean {
  return webhookRateLimiter.check(workflowId);
}

function getRateLimitStatus(workflowId: string) {
  return webhookRateLimiter.status(workflowId);
}

// GET webhook secret
webhooks.get('/:workflowId/secret', (c) => {
  const workflowId = c.req.param('workflowId');
  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const secret = db.getOrCreateWebhookSecret(workflowId);
  return c.json({
    ok: true,
    data: {
      secret,
      rateLimit: getRateLimitStatus(workflowId),
    },
  });
});

// GET rate-limit status (no secret)
webhooks.get('/:workflowId/rate-limit', (c) => {
  const workflowId = c.req.param('workflowId');
  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: getRateLimitStatus(workflowId) });
});

// POST regenerate secret
webhooks.post('/:workflowId/regenerate', (c) => {
  const workflowId = c.req.param('workflowId');
  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const secret = db.regenerateWebhookSecret(workflowId);
  return c.json({ ok: true, data: { secret } });
});

// POST /api/webhook/:workflowId — trigger workflow
webhooks.post('/:workflowId', async (c) => {
  const workflowId = c.req.param('workflowId');

  // Rate limit check
  if (!checkRateLimit(workflowId)) {
    return c.json({ ok: false, error: 'Rate limit exceeded' }, 429);
  }

  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const secret = db.getOrCreateWebhookSecret(workflowId);

  // Read raw body for HMAC verification
  const rawBody = await c.req.text();
  const sigHeader = c.req.header('x-neos-signature') ?? '';

  if (!db.verifyWebhookSignature(secret, rawBody, sigHeader)) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401);
  }

  // Parse body as JSON inputs
  let triggerInputs: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      triggerInputs = parsed as Record<string, unknown>;
    }
  } catch {
    // non-JSON body — use empty inputs
  }

  const settings = getWorkflowSecrets();
  const controller = new AbortController();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const nodeResults: Record<string, unknown> = {};

  // Load Design System content if the workflow has one configured
  const designSystemContent = wf.designSystemId
    ? (await getDesignSystemContent(wf.designSystemId)) ?? undefined
    : undefined;

  db.saveRun({
    id: runId,
    workflowId: wf.id,
    status: 'running',
    nodeResults: nodeResults as never,
    startedAt: now,
  });

  return stream(c, async (writableStream) => {
    const sendEvent = async (event: WorkflowSSEEvent) => {
      await writableStream.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    c.req.raw.signal.addEventListener('abort', () => controller.abort());

    try {
      await executeWorkflow({
        runId,
        triggerInputs,
        workflow: wf,
        settings,
        onEvent: (event) => {
          sendEvent(event).catch(() => controller.abort());
          if (event.type === 'node.completed') {
            nodeResults[event.nodeId] = { status: 'completed', output: event.output, durationMs: event.durationMs };
          }
          if (event.type === 'node.failed') {
            nodeResults[event.nodeId] = { status: 'failed', error: event.error };
          }
        },
        signal: controller.signal,
        cliSpawn: (cliId, prompt, onChunk, signal) =>
          spawnCliAgent({ cliId, prompt, onChunk, signal }),
        designSystemContent,
      });

      const finalStatus = controller.signal.aborted ? 'cancelled' : 'completed';
      db.saveRun({
        id: runId,
        workflowId: wf.id,
        status: finalStatus,
        nodeResults: nodeResults as never,
        startedAt: now,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Execution error';
      await sendEvent({ type: 'run.failed', runId, error: errorMsg });
      db.saveRun({
        id: runId,
        workflowId: wf.id,
        status: 'failed',
        nodeResults: nodeResults as never,
        startedAt: now,
        completedAt: new Date().toISOString(),
        error: errorMsg,
      });
    }
  });
});

export default webhooks;
