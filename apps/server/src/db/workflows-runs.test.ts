import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import * as workflows from './workflows.js';

const NAME = `_cov_runs_${process.pid}`;

afterEach(() => {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ?').all(NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
});

describe('workflow runs CRUD', () => {
  it('saves, lists, filters delete by status, truncates huge nodeResults', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const okId = crypto.randomUUID();
    const failId = crypto.randomUUID();
    workflows.saveRun({
      id: okId,
      workflowId: wf.id,
      status: 'completed',
      nodeResults: { n1: { status: 'completed', output: 'ok' } as never },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    workflows.saveRun({
      id: failId,
      workflowId: wf.id,
      status: 'failed',
      nodeResults: {},
      startedAt: new Date().toISOString(),
      error: 'boom',
    });

    expect(workflows.getRun(okId)?.status).toBe('completed');
    expect(workflows.listRuns(wf.id).length).toBe(2);

    const deletedFailed = workflows.deleteRuns(wf.id, 'failed');
    expect(deletedFailed).toBe(1);
    expect(workflows.getRun(failId)).toBeUndefined();
    expect(workflows.getRun(okId)).toBeTruthy();

    expect(workflows.deleteRun(okId)).toBe(true);
    expect(workflows.deleteRun(okId)).toBe(false);

    // huge payload truncated
    const bigId = crypto.randomUUID();
    const huge = 'x'.repeat(1_100_000);
    workflows.saveRun({
      id: bigId,
      workflowId: wf.id,
      status: 'completed',
      nodeResults: { blob: { status: 'completed', output: huge } as never },
      startedAt: new Date().toISOString(),
    });
    const stored = workflows.getRun(bigId);
    expect(stored?.nodeResults).toEqual({ truncated: true });
  });

  it('updateWorkflow patches name/description and deleteWorkflow', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      description: 'old',
      domain: 'coding',
      nodes: [{ id: 't', type: 'trigger', label: 'T', config: {} }],
      edges: [],
    });
    const updated = workflows.updateWorkflow(wf.id, {
      name: NAME,
      description: 'new desc',
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
    });
    expect(updated?.description).toBe('new desc');
    expect(updated?.nodes).toHaveLength(2);
    expect(workflows.listWorkflows().some((w) => w.id === wf.id)).toBe(true);
    expect(workflows.updateWorkflow('missing', { name: 'x' })).toBeUndefined();
    expect(workflows.deleteWorkflow(wf.id)).toBe(true);
    expect(workflows.getWorkflow(wf.id)).toBeUndefined();
  });
});
