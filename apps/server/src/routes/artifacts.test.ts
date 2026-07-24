import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import artifacts from './artifacts.js';

const WF_NAME = `_cov_art_route_${process.pid}`;

function cleanup() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM artifacts WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
}

afterEach(cleanup);

describe('artifacts routes', () => {
  it('requires workflowId or runId on list', async () => {
    const res = await artifacts.request('/');
    expect(res.status).toBe(400);
    const blank = await artifacts.request('/?workflowId=%20%20%20');
    expect(blank.status).toBe(400);
  });

  it('rejects whitespace-only content on create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const res = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'x.html',
        contentType: 'text/html',
        content: '   \n  ',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body on create', async () => {
    const res = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid JSON/i);
  });

  it('CRUD, preview, patch, refresh reload/rerun', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const runId = crypto.randomUUID();

    const bad = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(bad.status).toBe(400);

    const blankName = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: '   ',
        contentType: 'text/html',
      }),
    });
    expect(blankName.status).toBe(400);

    const create = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: `  ${wf.id}  `,
        runId: `  ${runId}  `,
        name: '  preview.html  ',
        contentType: '  text/html  ',
        content: '<html><body>hi</body></html>',
        nodeId: '  agent-1  ',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; name: string; contentType: string } };
    const id = created.data.id;
    expect(created.data.name).toBe('preview.html');
    expect(created.data.contentType).toBe('text/html');

    const list = await artifacts.request(`/?workflowId=${wf.id}`);
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((a) => a.id === id)).toBe(true);

    const byRun = await artifacts.request(`/?runId=${runId}`);
    const byRunBody = await byRun.json() as { data: Array<{ id: string }> };
    expect(byRunBody.data.some((a) => a.id === id)).toBe(true);

    const get = await artifacts.request(`/${id}`);
    expect(get.status).toBe(200);

    const preview = await artifacts.request(`/${id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toMatch(/html/);
    expect(await preview.text()).toContain('hi');

    const putWs = await artifacts.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   \n  ' }),
    });
    expect(putWs.status).toBe(400);

    const put = await artifacts.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '<html>updated</html>' }),
    });
    expect(put.status).toBe(200);

    const patchBlank = await artifacts.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(patchBlank.status).toBe(400);

    const patch = await artifacts.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  renamed.html  ' }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json() as { data: { name: string } };
    expect(patched.data.name).toBe('renamed.html');

    const reload = await artifacts.request(`/${id}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'reload' }),
    });
    expect(reload.status).toBe(200);
    const reloadBody = await reload.json() as { meta: { mode: string } };
    expect(reloadBody.meta.mode).toBe('reload');

    const rerun = await artifacts.request(`/${id}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'rerun' }),
    });
    expect(rerun.status).toBe(200);
    const rerunBody = await rerun.json() as { meta: { mode: string; workflowId: string } };
    expect(rerunBody.meta.mode).toBe('rerun');
    expect(rerunBody.meta.workflowId).toBe(wf.id);

    const del = await artifacts.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await artifacts.request(`/${id}`);
    expect(missing.status).toBe(404);
  });
});
