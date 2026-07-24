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
  it('rejects blank id/workflowId on saveRun', () => {
    expect(() =>
      workflows.saveRun({
        id: '  ',
        workflowId: 'wf',
        status: 'running',
        nodeResults: {},
        startedAt: new Date().toISOString(),
      }),
    ).toThrow(/non-blank/i);
    expect(() =>
      workflows.saveRun({
        id: 'run-x',
        workflowId: '   ',
        status: 'running',
        nodeResults: {},
        startedAt: new Date().toISOString(),
      }),
    ).toThrow(/non-blank/i);
  });

  it('defaults missing nodeResults to empty object and trims ids', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const runId = crypto.randomUUID();
    workflows.saveRun({
      id: `  ${runId}  `,
      workflowId: `  ${wf.id}  `,
      status: 'running',
      // nodeResults intentionally omitted
      startedAt: new Date().toISOString(),
    } as never);
    const stored = workflows.getRun(runId);
    expect(stored?.workflowId).toBe(wf.id);
    expect(stored?.nodeResults).toEqual({});
  });

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
      id: `  ${okId}  `,
      workflowId: `  ${wf.id}  `,
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

  it('listRuns clamps limit/offset and deleteRuns trims blank/status', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    for (let i = 0; i < 5; i++) {
      workflows.saveRun({
        id: crypto.randomUUID(),
        workflowId: wf.id,
        status: i % 2 === 0 ? 'completed' : 'failed',
        nodeResults: {},
        startedAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    expect(workflows.listRuns('   ')).toEqual([]);
    expect(workflows.listRuns(wf.id, 0, -10).length).toBeGreaterThanOrEqual(1);
    expect(workflows.listRuns(wf.id, 0, -10).length).toBeLessThanOrEqual(100);
    expect(workflows.listRuns(wf.id, 2, 0).length).toBe(2);
    expect(workflows.listRuns(wf.id, 999, 0).length).toBeLessThanOrEqual(5);

    expect(workflows.deleteRuns('   ')).toBe(0);
    expect(workflows.deleteRuns(`  ${wf.id}  `, '  failed  ')).toBeGreaterThanOrEqual(1);
    expect(workflows.deleteRuns(`  ${wf.id}  `)).toBeGreaterThanOrEqual(1);
    expect(workflows.listRuns(wf.id)).toEqual([]);
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
    expect(workflows.getWorkflow(`  ${wf.id}  `)?.id).toBe(wf.id);
    expect(workflows.getWorkflow('   ')).toBeUndefined();
    expect(workflows.deleteWorkflow('   ')).toBe(false);
    expect(workflows.deleteWorkflow(wf.id)).toBe(true);
    expect(workflows.getWorkflow(wf.id)).toBeUndefined();
  });

  it('updateWorkflow keeps prior name on blank trim; clears designSystemId; deleteRun blanks', () => {
    const wf = workflows.createWorkflow({
      name: NAME,
      description: '  keep me  ',
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(wf.description).toBe('keep me');

    workflows.updateWorkflow(wf.id, { designSystemId: '  ds-1  ' });
    expect(workflows.getWorkflow(wf.id)?.designSystemId).toBe('ds-1');

    // blank name after trim keeps existing name
    const sameName = workflows.updateWorkflow(wf.id, { name: '   ' });
    expect(sameName?.name).toBe(NAME);

    // empty description clears to undefined
    const clearedDesc = workflows.updateWorkflow(wf.id, { description: '   ' });
    expect(clearedDesc?.description).toBeUndefined();

    // empty designSystemId clears binding
    const clearedDs = workflows.updateWorkflow(wf.id, { designSystemId: '  ' });
    expect(clearedDs?.designSystemId).toBeUndefined();

    const runId = crypto.randomUUID();
    workflows.saveRun({
      id: runId,
      workflowId: wf.id,
      status: 'completed',
      nodeResults: {},
      startedAt: new Date().toISOString(),
    });
    expect(workflows.getRun(`  ${runId}  `)?.id).toBe(runId);
    expect(workflows.getRun('   ')).toBeUndefined();
    expect(workflows.deleteRun('   ')).toBe(false);
    expect(workflows.deleteRun(`  ${runId}  `)).toBe(true);
    expect(workflows.getRun(runId)).toBeUndefined();

    expect(workflows.updateWorkflow('   ', { name: 'x' })).toBeUndefined();
  });

  it('createWorkflow rejects blank name and normalizes domain', () => {
    expect(() =>
      workflows.createWorkflow({
        name: '   ',
        domain: 'general',
        nodes: [],
        edges: [],
      }),
    ).toThrow(/name is required/i);

    const wf = workflows.createWorkflow({
      name: `  ${NAME}_domain  `,
      description: '  d  ',
      domain: '  CODING  ',
      nodes: [],
      edges: [],
    });
    expect(wf.name).toBe(`${NAME}_domain`);
    expect(wf.description).toBe('d');
    expect(wf.domain).toBe('coding');

    const gen = workflows.createWorkflow({
      name: `${NAME}_unk`,
      domain: 'marketing' as never,
      nodes: [],
      edges: [],
    });
    expect(gen.domain).toBe('general');
    workflows.deleteWorkflow(wf.id);
    workflows.deleteWorkflow(gen.id);
  });
});
