import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeWorkflow } = vi.hoisted(() => ({
  executeWorkflow: vi.fn(async () => {}),
}));

vi.mock('@neos-work/workflow-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/workflow-engine')>();
  return { ...actual, executeWorkflow };
});

import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import { webhookRateLimiter } from '../lib/rate-limit.js';
import webhooks from './webhooks.js';

const WF_NAME = `_cov_wh_dh_${process.pid}`;
const DS_NAME = `_cov_ds_wh_dh_${process.pid}`;

function designContextMarkerPairs(s: string): number {
  const open = s.match(/<!-- DESIGN CONTEXT -->/g)?.length ?? 0;
  const close = s.match(/<!-- \/DESIGN CONTEXT -->/g)?.length ?? 0;
  return open === close ? open : -1;
}

async function cleanup() {
  const db = getDb();
  const rows = db
    .prepare('SELECT id FROM workflow WHERE name = ? OR name LIKE ?')
    .all(WF_NAME, `${WF_NAME}%`) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
  webhookRateLimiter.reset();
  try {
    const { deleteDesignSystem, listDesignSystems } = await import('../lib/design-system-store.js');
    const list = await listDesignSystems();
    for (const ds of list) {
      if (ds.name === DS_NAME || ds.name.startsWith(`${DS_NAME}_`)) {
        await deleteDesignSystem(ds.id).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
}

beforeEach(async () => {
  executeWorkflow.mockReset();
  executeWorkflow.mockResolvedValue(undefined);
  await cleanup();
});
afterEach(cleanup);

describe('webhook execute design harness', () => {
  it('webhook executeWorkflow inner includes tokens and RULES and no DESIGN CONTEXT marker', async () => {
    const {
      createDesignSystem,
      updateDesignSystemRules,
      updateDesignSystemTokens,
    } = await import('../lib/design-system-store.js');
    const ds = await createDesignSystem(DS_NAME, 'webhook harness');
    expect(ds).not.toBeNull();
    await updateDesignSystemRules(ds!.id, '# Agent rules\n- wh-keep-me\n');
    await updateDesignSystemTokens(ds!.id, ':root { --wh-token: 1 }');

    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    workflows.updateWorkflow(wf.id, { designSystemId: ds!.id });

    const secret = workflows.getOrCreateWebhookSecret(wf.id);
    const body = '{}';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const res = await webhooks.request(`/${wf.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neos-signature': `sha256=${sig}`,
      },
      body,
    });
    expect(res.status).toBe(200);
    await res.text().catch(() => '');

    expect(executeWorkflow).toHaveBeenCalled();
    const opts = executeWorkflow.mock.calls[0]![0] as { designSystemContent?: string };
    expect(typeof opts.designSystemContent).toBe('string');
    const inner = opts.designSystemContent ?? '';
    expect(inner).toContain('### RULES.md');
    expect(inner).toContain('wh-keep-me');
    expect(inner).toContain('### tokens.css');
    expect(inner).toContain('--wh-token');
    expect(inner).not.toContain('DESIGN CONTEXT');
    expect(designContextMarkerPairs(inner)).toBe(0);
  });
});
