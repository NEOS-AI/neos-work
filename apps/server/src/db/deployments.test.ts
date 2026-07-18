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
});
