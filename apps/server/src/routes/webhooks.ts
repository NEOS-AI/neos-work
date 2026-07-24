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
import { getExecutionSettings } from '../db/settings.js';
import { spawnCliAgent } from '../lib/cli-agents.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from '../lib/runtime-context.js';
import { createFirstHtmlArtifact } from '../lib/html-artifact.js';
import * as artifactDb from '../db/artifacts.js';
import { getDesignSystemContent } from '../lib/design-system-store.js';
import { webhookRateLimiter } from '../lib/rate-limit.js';

const webhooks = new Hono();

function checkRateLimit(workflowId: string): boolean {
  return webhookRateLimiter.check(workflowId);
}

function getRateLimitStatus(workflowId: string) {
  return webhookRateLimiter.status(workflowId);
}

function paramWorkflowId(c: { req: { param: (k: string) => string } }): string {
  return c.req.param('workflowId').trim();
}

// GET webhook secret
webhooks.get('/:workflowId/secret', (c) => {
  const workflowId = paramWorkflowId(c);
  if (!workflowId) return c.json({ ok: false, error: 'Not found' }, 404);
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
  const workflowId = paramWorkflowId(c);
  if (!workflowId) return c.json({ ok: false, error: 'Not found' }, 404);
  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: getRateLimitStatus(workflowId) });
});

// POST regenerate secret
webhooks.post('/:workflowId/regenerate', (c) => {
  const workflowId = paramWorkflowId(c);
  if (!workflowId) return c.json({ ok: false, error: 'Not found' }, 404);
  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const secret = db.regenerateWebhookSecret(workflowId);
  return c.json({ ok: true, data: { secret } });
});

// POST /api/webhook/:workflowId — trigger workflow
webhooks.post('/:workflowId', async (c) => {
  const workflowId = paramWorkflowId(c);
  if (!workflowId) return c.json({ ok: false, error: 'Not found' }, 404);

  // Rate limit check
  if (!checkRateLimit(workflowId)) {
    return c.json({ ok: false, error: 'Rate limit exceeded' }, 429);
  }

  const wf = db.getWorkflow(workflowId);
  if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

  const secret = db.getOrCreateWebhookSecret(workflowId);

  // Read raw body for HMAC verification (cap size to avoid memory abuse)
  const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MiB
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ ok: false, error: 'Request body too large' }, 413);
    }
  }
  const rawBody = await c.req.text();
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return c.json({ ok: false, error: 'Request body too large' }, 413);
  }
  const sigHeader = c.req.header('x-neos-signature') ?? '';

  if (!db.verifyWebhookSignature(secret, rawBody, sigHeader)) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401);
  }

  // Parse body as JSON inputs (objects only; arrays/primitives → empty)
  let triggerInputs: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      triggerInputs = parsed as Record<string, unknown>;
    }
  } catch {
    // non-JSON body — use empty inputs
  }

  const settings = getExecutionSettings({
    serverUrl: getRuntimeServerUrl(),
    authToken: getRuntimeAuthToken(),
  });
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
          spawnCliAgent({
            cliId,
            prompt,
            onChunk,
            signal,
            workflowId: wf.id,
            runId,
            serverUrl: getRuntimeServerUrl(),
            authToken: getRuntimeAuthToken(),
          }),
        designSystemContent,
      });

      // Auto-detect HTML artifacts (same as workflow run path)
      const artifactId = createFirstHtmlArtifact({
        workflowId: wf.id,
        runId,
        nodeResults,
        create: (input) => artifactDb.createArtifact(input),
      });
      if (artifactId) {
        await sendEvent({ type: 'run.completed', runId, duration: 0, artifactId });
      }

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
