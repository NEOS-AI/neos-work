import { afterEach, describe, expect, it } from 'vitest';
import { ARTIFACT_CONTENT_MAX_CHARS } from '../db/artifacts.js';
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

  it('returns 404 for control-char or overlong artifact ids', async () => {
    const ctrl = await artifacts.request('/%0aevil');
    expect(ctrl.status).toBe(404);
    const refresh = await artifacts.request('/%0aevil/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(refresh.status).toBe(404);
    const overlong = await artifacts.request(`/${'x'.repeat(101)}`);
    expect(overlong.status).toBe(404);
  });

  it('rejects invalid runId/nodeId on create', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const badName = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: '\nx.html',
        contentType: 'text/html',
        content: '<p>x</p>',
      }),
    });
    expect(badName.status).toBe(400);
    const badRun = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'x.html',
        contentType: 'text/html',
        content: '<p>x</p>',
        runId: 'bad\nid',
      }),
    });
    expect(badRun.status).toBe(400);
    const badNode = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'x.html',
        contentType: 'text/html',
        content: '<p>x</p>',
        nodeId: 'n'.repeat(201),
      }),
    });
    expect(badNode.status).toBe(400);
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

  it('404s blank path ids and rejects non-string content on PATCH', async () => {
    const blankGet = await artifacts.request('/%20');
    expect(blankGet.status).toBe(404);
    const blankDel = await artifacts.request('/%20', { method: 'DELETE' });
    expect(blankDel.status).toBe(404);
    const blankPreview = await artifacts.request('/%20/preview');
    expect(blankPreview.status).toBe(404);

    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const create = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'patch-me.html',
        contentType: 'text/html',
        content: '<html>x</html>',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };

    const nonString = await artifacts.request(`/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 123 }),
    });
    expect(nonString.status).toBe(400);
    expect(((await nonString.json()) as { error: string }).error).toMatch(/content must be a string/i);

    const emptyPatch = await artifacts.request(`/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(emptyPatch.status).toBe(400);
    expect(((await emptyPatch.json()) as { error: string }).error).toMatch(/name and\/or content/i);

    const putMissing = await artifacts.request(`/${created.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(putMissing.status).toBe(400);
    expect(((await putMissing.json()) as { error: string }).error).toMatch(/content string required/i);

    await artifacts.request(`/${created.data.id}`, { method: 'DELETE' });
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

  it('serves text/plain preview and rejects overlong names', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const longName = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'n'.repeat(201),
        contentType: 'text/plain',
        content: 'x',
      }),
    });
    expect(longName.status).toBe(400);

    const create = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'notes.txt',
        contentType: 'text/plain',
        content: 'hello plain',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };

    const preview = await artifacts.request(`/${created.data.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await preview.text()).toBe('hello plain');

    // empty content allowed; blank contentType rejected
    const emptyOk = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'empty.html',
        contentType: 'text/html',
        content: '',
      }),
    });
    expect(emptyOk.status).toBe(201);

    const noType = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'no-type',
        contentType: '   ',
      }),
    });
    expect(noType.status).toBe(400);

    // patch whitespace content rejected; refresh defaults unknown mode to reload
    const patchWs = await artifacts.request(`/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '  \n  ' }),
    });
    expect(patchWs.status).toBe(400);

    const refresh = await artifacts.request(`/${created.data.id}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: '  UNKNOWN  ' }),
    });
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json() as { meta: { mode: string } };
    expect(refreshBody.meta.mode).toBe('reload');

    // missing artifact ops
    expect((await artifacts.request('/no-such-id')).status).toBe(404);
    expect((await artifacts.request('/no-such-id', { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await artifacts.request('/no-such-id/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(404);

    await artifacts.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('rejects oversized content on create/put/patch with 400', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const huge = 'x'.repeat(ARTIFACT_CONTENT_MAX_CHARS + 1);

    const create = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'huge.html',
        contentType: 'text/html',
        content: huge,
      }),
    });
    expect(create.status).toBe(400);
    expect(((await create.json()) as { error: string }).error).toMatch(/max size/i);

    const ok = await artifacts.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: wf.id,
        name: 'ok.html',
        contentType: 'text/html',
        content: '<p>ok</p>',
      }),
    });
    expect(ok.status).toBe(201);
    const id = ((await ok.json()) as { data: { id: string } }).data.id;

    const put = await artifacts.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: huge }),
    });
    expect(put.status).toBe(400);
    expect(((await put.json()) as { error: string }).error).toMatch(/max size/i);

    const patch = await artifacts.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: huge }),
    });
    expect(patch.status).toBe(400);
    expect(((await patch.json()) as { error: string }).error).toMatch(/max size/i);

    // prior content unchanged
    const get = await artifacts.request(`/${id}`);
    expect(((await get.json()) as { data: { content: string } }).data.content).toBe('<p>ok</p>');

    await artifacts.request(`/${id}`, { method: 'DELETE' });
  });
});
