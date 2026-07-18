import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import {
  createDeployment,
  deleteDeployment,
  getDeployment,
  listDeployments,
  updateDeployment,
} from './deployments.js';

const MARKER = `_cov_dep_${process.pid}`;

afterEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM deployments WHERE project_name LIKE ?").run(`${MARKER}%`);
});

describe('deployments CRUD', () => {
  it('creates, lists, updates status, deletes', () => {
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-proj`,
      status: 'deploying',
      deploymentId: 'dpl_test',
    });
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('deploying');

    const listed = listDeployments({ limit: 50 });
    expect(listed.some((d) => d.id === row.id)).toBe(true);

    const updated = updateDeployment(row.id, {
      status: 'success',
      url: 'https://example.vercel.app',
      statusMessage: 'READY',
    });
    expect(updated?.status).toBe('success');
    expect(updated?.url).toContain('vercel.app');
    expect(getDeployment(row.id)?.statusMessage).toBe('READY');

    expect(deleteDeployment(row.id)).toBe(true);
    expect(getDeployment(row.id)).toBeUndefined();
  });

  it('filters list by workflowId and returns empty for unknown', () => {
    const wfId = crypto.randomUUID();
    const a = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-a`,
      status: 'pending',
      workflowId: wfId,
    });
    createDeployment({
      provider: 'cloudflare',
      projectName: `${MARKER}-b`,
      status: 'pending',
      workflowId: crypto.randomUUID(),
    });
    const filtered = listDeployments({ workflowId: wfId, limit: 50 });
    expect(filtered.every((d) => d.workflowId === wfId)).toBe(true);
    expect(filtered.some((d) => d.id === a.id)).toBe(true);
    expect(listDeployments({ workflowId: 'missing-wf', limit: 10 })).toEqual([]);
  });

  it('respects limit and supports failed status update', () => {
    for (let i = 0; i < 5; i++) {
      createDeployment({
        provider: 'vercel',
        projectName: `${MARKER}-lim-${i}`,
        status: 'pending',
      });
    }
    const limited = listDeployments({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);

    const row = createDeployment({
      provider: 'cloudflare',
      projectName: `${MARKER}-fail`,
      status: 'deploying',
    });
    const failed = updateDeployment(row.id, {
      status: 'failed',
      statusMessage: 'timeout',
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.statusMessage).toBe('timeout');
    expect(deleteDeployment('no-such-id')).toBe(false);
  });
});
