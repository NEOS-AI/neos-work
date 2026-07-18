import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import * as workflows from './workflows.js';

const NAME = `_cov_dup_${process.pid}`;

afterEach(() => {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name LIKE ?').all(`${NAME}%`) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_run WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
});

describe('duplicateWorkflow', () => {
  it('copies designSystemId onto the duplicate', () => {
    const src = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    workflows.updateWorkflow(src.id, { designSystemId: 'ds-copy-me' });
    const copy = workflows.duplicateWorkflow(src.id);
    expect(copy?.name).toContain('(copy)');
    expect(copy?.designSystemId).toBe('ds-copy-me');
  });

  it('duplicates without designSystemId when source has none', () => {
    const src = workflows.createWorkflow({
      name: NAME,
      domain: 'coding',
      nodes: [],
      edges: [],
    });
    const copy = workflows.duplicateWorkflow(src.id);
    expect(copy?.designSystemId).toBeUndefined();
    expect(copy?.domain).toBe('coding');
  });

  it('returns undefined when source workflow is missing', () => {
    expect(workflows.duplicateWorkflow('missing-wf-id')).toBeUndefined();
  });

  it('copies nodes and edges', () => {
    const src = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [
        { id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
        { id: 'o', type: 'output', label: 'O', position: { x: 100, y: 0 }, config: {} },
      ] as never,
      edges: [{ id: 'e1', source: 't', target: 'o' }] as never,
    });
    const copy = workflows.duplicateWorkflow(src.id);
    expect(copy?.nodes).toHaveLength(2);
    expect(copy?.edges).toHaveLength(1);
    expect(copy?.id).not.toBe(src.id);
  });
});

describe('deleteRuns', () => {
  it('deletes by status and all', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    workflows.saveRun({
      id: crypto.randomUUID(),
      workflowId: wf.id,
      status: 'completed',
      nodeResults: {},
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    workflows.saveRun({
      id: crypto.randomUUID(),
      workflowId: wf.id,
      status: 'failed',
      nodeResults: {},
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: 'x',
    });
    expect(workflows.listRuns(wf.id, 10, 0)).toHaveLength(2);
    expect(workflows.deleteRuns(wf.id, 'completed')).toBe(1);
    expect(workflows.listRuns(wf.id, 10, 0)).toHaveLength(1);
    expect(workflows.deleteRuns(wf.id)).toBe(1);
    expect(workflows.listRuns(wf.id, 10, 0)).toHaveLength(0);
  });
});
