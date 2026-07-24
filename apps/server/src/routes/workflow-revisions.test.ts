import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import * as revDb from '../db/workflow-revisions.js';
import workflowRevisions from './workflow-revisions.js';

const WF_NAME = `_cov_rev_route_${process.pid}`;

function cleanup() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ? OR name LIKE ?').all(WF_NAME, `${WF_NAME}%`) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_revisions WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
}

afterEach(cleanup);

describe('workflow-revisions routes', () => {
  it('404s list for missing workflow', async () => {
    const res = await workflowRevisions.request('/no-such-wf');
    expect(res.status).toBe(404);
  });

  it('lists, gets, patches label, restores, deletes', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [{ id: 't', type: 'trigger', label: 'Start', config: {} }],
      edges: [],
    });

    const rev = revDb.createRevision(
      wf.id,
      JSON.stringify({
        name: WF_NAME,
        description: 'snap',
        nodes: [
          { id: 't', type: 'trigger', label: 'Start', config: {} },
          { id: 'o', type: 'output', label: 'End', config: {} },
        ],
        edges: [{ id: 'e1', source: 't', target: 'o' }],
      }),
      'test-snap',
    );

    const list = await workflowRevisions.request(`/${wf.id}`);
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((r) => r.id === rev.id)).toBe(true);

    const get = await workflowRevisions.request(`/${wf.id}/${rev.id}`);
    expect(get.status).toBe(200);

    const patchBlank = await workflowRevisions.request(`/${wf.id}/${rev.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '   ' }),
    });
    expect(patchBlank.status).toBe(400);

    const patch = await workflowRevisions.request(`/${wf.id}/${rev.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '  renamed-label  ' }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json() as { data: { label?: string } };
    expect(patched.data.label).toBe('renamed-label');

    // mutate live workflow then restore
    workflows.updateWorkflow(wf.id, {
      nodes: [{ id: 't', type: 'trigger', label: 'Changed', config: {} }],
      edges: [],
    });

    const restore = await workflowRevisions.request(`/${wf.id}/${rev.id}/restore`, {
      method: 'POST',
    });
    expect(restore.status).toBe(200);
    const after = workflows.getWorkflow(wf.id);
    expect(after?.nodes.some((n) => n.id === 'o')).toBe(true);

    const del = await workflowRevisions.request(`/${wf.id}/${rev.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await workflowRevisions.request(`/${wf.id}/${rev.id}`);
    expect(missing.status).toBe(404);
  });

  it('returns 404 for blank ids and 400 for invalid patch JSON', async () => {
    const blankList = await workflowRevisions.request('/%20');
    expect(blankList.status).toBe(404);

    const blankGet = await workflowRevisions.request('/%20/%20');
    expect(blankGet.status).toBe(404);

    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [{ id: 't', type: 'trigger', label: 'Start', config: {} }],
      edges: [],
    });
    const rev = revDb.createRevision(
      wf.id,
      JSON.stringify({
        name: WF_NAME,
        nodes: [{ id: 't', type: 'trigger', label: 'Start', config: {} }],
        edges: [],
      }),
      'json-hygiene',
    );

    const badJson = await workflowRevisions.request(`/${wf.id}/${rev.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    // invalid JSON → body null → empty label → 400 Invalid label
    expect(badJson.status).toBe(400);

    const blankIdsRestore = await workflowRevisions.request(`/%20/${rev.id}/restore`, {
      method: 'POST',
    });
    expect(blankIdsRestore.status).toBe(404);
  });
});
