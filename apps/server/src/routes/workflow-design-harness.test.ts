import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeWorkflow } = vi.hoisted(() => ({
  executeWorkflow: vi.fn(async () => {}),
}));

vi.mock('@neos-work/workflow-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/workflow-engine')>();
  return { ...actual, executeWorkflow };
});

import { getDb } from '../db/schema.js';
import workflow from './workflow.js';

const WF_NAME = `_cov_wf_dh_${process.pid}`;
const DS_NAME = `_cov_ds_wf_dh_${process.pid}`;

const minimalGraph = {
  nodes: [
    { id: 't', type: 'trigger', label: 'Start', config: {} },
    { id: 'o', type: 'output', label: 'End', config: {} },
  ],
  edges: [{ id: 'e1', source: 't', target: 'o' }],
};

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
    db.prepare('DELETE FROM workflow_revisions WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM artifacts WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
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

beforeEach(() => {
  executeWorkflow.mockReset();
  executeWorkflow.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('workflow execute design harness', () => {
  it('executeWorkflow designSystemContent is marker-free inner with RULES and tokens', async () => {
    const {
      createDesignSystem,
      updateDesignSystemRules,
      updateDesignSystemTokens,
    } = await import('../lib/design-system-store.js');
    const ds = await createDesignSystem(DS_NAME, 'workflow harness');
    expect(ds).not.toBeNull();
    await updateDesignSystemRules(ds!.id, '# Agent rules\n- wf-keep-me\n');
    await updateDesignSystemTokens(ds!.id, ':root { --wf-token: 1 }');

    const create = await workflow.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: WF_NAME, ...minimalGraph }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;
    await workflow.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: ds!.id }),
    });

    const res = await workflow.request(`/${id}/run`, { method: 'POST' });
    expect(res.status).toBe(200);
    await res.text();

    expect(executeWorkflow).toHaveBeenCalled();
    const opts = executeWorkflow.mock.calls[0]![0] as { designSystemContent?: string };
    expect(typeof opts.designSystemContent).toBe('string');
    const inner = opts.designSystemContent ?? '';
    expect(inner).toContain('### RULES.md');
    expect(inner).toContain('wf-keep-me');
    expect(inner).toContain('### tokens.css');
    expect(inner).toContain('--wf-token');
    expect(inner).not.toContain('DESIGN CONTEXT');
    expect(designContextMarkerPairs(inner)).toBe(0);
  });
});
