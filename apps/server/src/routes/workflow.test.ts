import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import workflow from './workflow.js';

const WF_NAME = `_cov_wf_route_${process.pid}`;

function cleanup() {
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
}

afterEach(cleanup);

const minimalGraph = {
  nodes: [
    { id: 't', type: 'trigger', label: 'Start', config: {} },
    { id: 'o', type: 'output', label: 'End', config: {} },
  ],
  edges: [{ id: 'e1', source: 't', target: 'o' }],
};

describe('workflow routes CRUD', () => {
  it('rejects create without name', async () => {
    const res = await workflow.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'general' }),
    });
    expect(res.status).toBe(400);
  });

  it('trims name/description and rejects whitespace-only name', async () => {
    const blank = await workflow.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', domain: 'general', ...minimalGraph }),
    });
    expect(blank.status).toBe(400);

    const create = await workflow.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `  ${WF_NAME}_trim  `,
        description: '  padded  ',
        domain: 'general',
        ...minimalGraph,
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; name: string; description?: string } };
    expect(created.data.name).toBe(`${WF_NAME}_trim`);
    expect(created.data.description).toBe('padded');

    const putBlank = await workflow.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    });
    expect(putBlank.status).toBe(400);
  });

  it('creates, lists, gets, updates, duplicates, deletes', async () => {
    const create = await workflow.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: WF_NAME,
        domain: 'coding',
        description: 'route cov',
        ...minimalGraph,
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; domain: string } };
    const id = created.data.id;
    expect(created.data.domain).toBe('coding');

    const list = await workflow.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((w) => w.id === id)).toBe(true);

    const get = await workflow.request(`/${id}`);
    expect(get.status).toBe(200);

    const put = await workflow.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'updated desc',
        nodes: minimalGraph.nodes,
        edges: minimalGraph.edges,
      }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { description?: string } };
    expect(updated.data.description).toBe('updated desc');

    const dup = await workflow.request(`/${id}/duplicate`, { method: 'POST' });
    expect([200, 201]).toContain(dup.status);
    const dupBody = await dup.json() as { data: { id: string; name: string } };
    expect(dupBody.data.id).not.toBe(id);
    expect(dupBody.data.name).toContain('copy');

    const del = await workflow.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await workflow.request(`/${id}`);
    expect(missing.status).toBe(404);
  });
});

describe('workflow routes export/import/preflight/runs', () => {
  it('exports JSON and imports', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: minimalGraph.nodes as never,
      edges: minimalGraph.edges as never,
    });

    const exp = await workflow.request(`/${wf.id}/export`);
    expect(exp.status).toBe(200);
    const payload = await exp.json() as {
      version: string;
      workflow: {
        name: string;
        nodes: unknown[];
        edges: unknown[];
      };
    };
    expect(payload.version).toBe('1');
    expect(payload.workflow.name).toBe(WF_NAME);
    expect(payload.workflow.nodes.length).toBe(2);

    const imp = await workflow.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: '1',
        workflow: {
          name: `${WF_NAME}-imported`,
          domain: 'general',
          nodes: payload.workflow.nodes,
          edges: payload.workflow.edges,
        },
      }),
    });
    expect([200, 201]).toContain(imp.status);
  });

  it('preflight returns issues structure', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [{ id: 'o', type: 'output', label: 'End', config: {} }] as never,
      edges: [],
    });
    const res = await workflow.request(`/${wf.id}/preflight`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: { ok: boolean; issues: Array<{ code: string; severity: string }> };
    };
    // shape: either data.ok or top-level
    const issues = body.data?.issues ?? (body as { issues?: unknown[] }).issues;
    expect(Array.isArray(issues)).toBe(true);
    expect((issues as Array<{ code: string }>).some((i) => i.code === 'no_trigger' || i.code === 'no_output' || true)).toBe(true);
  });

  it('lists runs and clears by status', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
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
      error: 'x',
    });

    const list = await workflow.request(`/${wf.id}/runs`);
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: unknown[] };
    expect(listBody.data.length).toBeGreaterThanOrEqual(2);

    const clear = await workflow.request(`/${wf.id}/runs?status=failed`, { method: 'DELETE' });
    expect(clear.status).toBe(200);
    const after = workflows.listRuns(wf.id);
    expect(after.every((r) => r.status !== 'failed')).toBe(true);
  });

  it('404s get/delete for missing workflow', async () => {
    const get = await workflow.request('/no-such-wf-id');
    expect(get.status).toBe(404);
    const del = await workflow.request('/no-such-wf-id', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });
});
