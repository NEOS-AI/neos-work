import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../db/schema.js';
import * as workflows from '../db/workflows.js';
import * as routinesDb from '../db/routines.js';
import routines from './routines.js';

const WF_NAME = `_cov_rtn_route_${process.pid}`;

function cleanup() {
  const db = getDb();
  const wfs = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const w of wfs) {
    const rs = db.prepare('SELECT id FROM routine WHERE workflow_id = ?').all(w.id) as Array<{ id: string }>;
    for (const r of rs) {
      db.prepare('DELETE FROM routine_run WHERE routine_id = ?').run(r.id);
      db.prepare('DELETE FROM routine WHERE id = ?').run(r.id);
    }
    db.prepare('DELETE FROM workflow WHERE id = ?').run(w.id);
  }
}

afterEach(cleanup);

describe('routines routes', () => {
  it('rejects create without required fields', async () => {
    const res = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates, lists, gets, updates schedule, deletes', async () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    const create = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Route Cov Routine',
        workflowId: wf.id,
        schedule: '0 9 * * *',
        timezone: 'UTC',
        enabled: false,
      }),
    });
    expect([200, 201]).toContain(create.status);
    const created = await create.json() as { data: { id: string; enabled: boolean; schedule: string } };
    expect(created.data.enabled).toBe(false);
    expect(created.data.schedule).toBe('0 9 * * *');
    const id = created.data.id;

    const list = await routines.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((r) => r.id === id)).toBe(true);

    const get = await routines.request(`/${id}`);
    expect(get.status).toBe(200);

    const put = await routines.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedule: '0 * * * *', timezone: 'Asia/Seoul' }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { schedule: string; timezone: string } };
    expect(updated.data.schedule).toBe('0 * * * *');
    expect(updated.data.timezone).toBe('Asia/Seoul');

    const runs = await routines.request(`/${id}/runs`);
    expect(runs.status).toBe(200);

    const del = await routines.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await routines.request(`/${id}`);
    expect(missing.status).toBe(404);
  });

  it('404s for missing workflow on create', async () => {
    const res = await routines.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'orphan',
        workflowId: 'no-such-wf',
        schedule: '0 9 * * *',
      }),
    });
    expect(res.status).toBe(404);
  });
});
