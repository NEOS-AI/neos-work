import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import liveArtifacts from './live-artifacts.js';
import toolsLiveArtifacts from './tools-live-artifacts.js';
import * as projects from '../db/projects.js';
import { getDb } from '../db/schema.js';
import { clearToolTokens } from '../lib/tool-tokens.js';

const app = new Hono();
app.route('/api/live-artifacts', liveArtifacts);
app.route('/api/tools/live-artifacts', toolsLiveArtifacts);

const NAME = `_live_route_${process.pid}`;
const projectIds: string[] = [];

afterEach(() => {
  clearToolTokens();
  const db = getDb();
  for (const id of [...projectIds, ...((db
    .prepare('SELECT id FROM projects WHERE name LIKE ?')
    .all(`${NAME}%`) as Array<{ id: string }>).map((r) => r.id))]) {
    const row = db.prepare('SELECT base_dir FROM projects WHERE id = ?').get(id) as
      | { base_dir: string }
      | undefined;
    db.prepare('DELETE FROM live_artifact_refreshes WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM live_artifacts WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  projectIds.length = 0;
});

async function makeProject() {
  const p = projects.createProject({ name: NAME });
  projectIds.push(p.id);
  return p;
}

describe('live-artifacts routes', () => {
  it('CRUD refresh and preview', async () => {
    const p = await makeProject();
    const create = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        name: 'Card',
        sourceTemplate: '<p>{{title}}</p>',
        inputs: { title: 'Hi' },
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { id: string; content: string } };
    expect(created.data.content).toContain('Hi');

    const list = await app.request(`/api/live-artifacts?projectId=${p.id}`);
    expect(list.status).toBe(200);

    const preview = await app.request(
      `/api/live-artifacts/${created.data.id}/preview?projectId=${p.id}`,
    );
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('Hi');

    const refresh = await app.request(
      `/api/live-artifacts/${created.data.id}/refresh?projectId=${p.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: { title: 'Refreshed' } }),
      },
    );
    expect(refresh.status).toBe(200);
    const refBody = (await refresh.json()) as {
      data: { artifact: { content: string }; refresh: { status: string } };
    };
    expect(refBody.data.artifact.content).toContain('Refreshed');
    expect(refBody.data.refresh.status).toBe('succeeded');

    const del = await app.request(
      `/api/live-artifacts/${created.data.id}?projectId=${p.id}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
  });

  it('tool token create/list; override projectId → 403', async () => {
    const p = await makeProject();
    const p2 = await makeProject();

    const tokRes = await app.request('/api/live-artifacts/tool-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        capabilities: ['live-artifacts'],
      }),
    });
    expect(tokRes.status).toBe(201);
    const tok = (await tokRes.json()) as { data: { token: string } };

    const create = await app.request('/api/tools/live-artifacts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok.data.token}`,
      },
      body: JSON.stringify({
        name: 'ToolArt',
        sourceTemplate: 'x={{v}}',
        inputs: { v: '1' },
      }),
    });
    expect(create.status).toBe(201);
    const art = (await create.json()) as { data: { id: string; projectId: string } };
    expect(art.data.projectId).toBe(p.id);

    const override = await app.request('/api/tools/live-artifacts/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok.data.token}`,
      },
      body: JSON.stringify({
        projectId: p2.id,
        name: 'Evil',
        sourceTemplate: 'nope',
      }),
    });
    expect(override.status).toBe(403);

    const list = await app.request('/api/tools/live-artifacts/list', {
      headers: { Authorization: `Bearer ${tok.data.token}` },
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: Array<{ id: string }> };
    expect(listBody.data.some((a) => a.id === art.data.id)).toBe(true);

    const refresh = await app.request('/api/tools/live-artifacts/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok.data.token}`,
      },
      body: JSON.stringify({ id: art.data.id, inputs: { v: '2' } }),
    });
    expect(refresh.status).toBe(200);

    const badAuth = await app.request('/api/tools/live-artifacts/list', {
      headers: { Authorization: 'Bearer not-a-token' },
    });
    expect(badAuth.status).toBe(401);
  });
});

describe('live-artifacts routes error and edge paths', () => {
  it('list requires projectId and existing project', async () => {
    const missing = await app.request('/api/live-artifacts');
    expect(missing.status).toBe(400);

    const unknown = await app.request('/api/live-artifacts?projectId=no-such-project');
    expect(unknown.status).toBe(404);
  });

  it('create rejects invalid body and missing project', async () => {
    const badJson = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const noPid = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(noPid.status).toBe(400);

    const noProject = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'missing-proj', name: 'x' }),
    });
    expect(noProject.status).toBe(404);

    const p = await makeProject();
    const badName = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: p.id, name: '' }),
    });
    expect(badName.status).toBe(400);
  });

  it('get, patch, delete, refreshes validation and success', async () => {
    const p = await makeProject();
    const create = await app.request('/api/live-artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        name: 'Edge',
        sourceTemplate: '<b>{{n}}</b>',
        inputs: { n: '1' },
        contentType: 'text/html',
      }),
    });
    expect(create.status).toBe(201);
    const art = (await create.json()) as { data: { id: string } };

    const getNoPid = await app.request(`/api/live-artifacts/${art.data.id}`);
    expect(getNoPid.status).toBe(400);

    const getMissing = await app.request(
      `/api/live-artifacts/00000000-0000-0000-0000-000000000000?projectId=${p.id}`,
    );
    expect(getMissing.status).toBe(404);

    const getOk = await app.request(`/api/live-artifacts/${art.data.id}?projectId=${p.id}`);
    expect(getOk.status).toBe(200);

    const previewNoPid = await app.request(`/api/live-artifacts/${art.data.id}/preview`);
    expect(previewNoPid.status).toBe(400);

    const patchBadJson = await app.request(
      `/api/live-artifacts/${art.data.id}?projectId=${p.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'x' },
    );
    expect(patchBadJson.status).toBe(400);

    const patchOk = await app.request(`/api/live-artifacts/${art.data.id}?projectId=${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Edge2',
        sourceTemplate: '<i>{{n}}</i>',
        inputs: { n: '2' },
        contentType: 'text/plain',
      }),
    });
    expect(patchOk.status).toBe(200);
    const patched = (await patchOk.json()) as { data: { name: string; content: string } };
    expect(patched.data.name).toBe('Edge2');
    expect(patched.data.content).toContain('2');

    const patchMissing = await app.request(
      `/api/live-artifacts/00000000-0000-0000-0000-000000000000?projectId=${p.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'nope' }),
      },
    );
    expect(patchMissing.status).toBe(404);

    const refreshes = await app.request(
      `/api/live-artifacts/${art.data.id}/refreshes?projectId=${p.id}&limit=5`,
    );
    expect(refreshes.status).toBe(200);

    const refreshesNoArt = await app.request(
      `/api/live-artifacts/00000000-0000-0000-0000-000000000000/refreshes?projectId=${p.id}`,
    );
    expect(refreshesNoArt.status).toBe(404);

    const refreshesNoPid = await app.request(`/api/live-artifacts/${art.data.id}/refreshes`);
    expect(refreshesNoPid.status).toBe(400);

    const refreshFail = await app.request(
      `/api/live-artifacts/00000000-0000-0000-0000-000000000000/refresh?projectId=${p.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(refreshFail.status).toBe(404);

    const delNoPid = await app.request(`/api/live-artifacts/${art.data.id}`, { method: 'DELETE' });
    expect(delNoPid.status).toBe(400);

    const delMissing = await app.request(
      `/api/live-artifacts/00000000-0000-0000-0000-000000000000?projectId=${p.id}`,
      { method: 'DELETE' },
    );
    expect(delMissing.status).toBe(404);
  });

  it('tool-tokens validates project and handles bad caps', async () => {
    const noPid = await app.request('/api/live-artifacts/tool-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(noPid.status).toBe(400);

    const noProj = await app.request('/api/live-artifacts/tool-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'missing' }),
    });
    expect(noProj.status).toBe(404);

    const p = await makeProject();
    const badCaps = await app.request('/api/live-artifacts/tool-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: p.id, capabilities: ['not-a-cap'] }),
    });
    expect(badCaps.status).toBe(400);

    const withQuery = await app.request(`/api/live-artifacts/tool-tokens?projectId=${p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-1', ttlMs: 60_000 }),
    });
    expect(withQuery.status).toBe(201);
  });

  it('tools update/list override and refresh validation', async () => {
    const p = await makeProject();
    const tokRes = await app.request('/api/live-artifacts/tool-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: p.id, capabilities: ['live-artifacts'] }),
    });
    const tok = (await tokRes.json()) as { data: { token: string } };
    const auth = { Authorization: `Bearer ${tok.data.token}`, 'Content-Type': 'application/json' };

    const created = await app.request('/api/tools/live-artifacts/create', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'T',
        sourceTemplate: 'v={{v}}',
        inputs: { v: 'a' },
      }),
    });
    expect(created.status).toBe(201);
    const art = (await created.json()) as { data: { id: string } };

    const updateOk = await app.request('/api/tools/live-artifacts/update', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        id: art.data.id,
        name: 'T2',
        sourceTemplate: 'v={{v}}',
        inputs: { v: 'b' },
      }),
    });
    expect(updateOk.status).toBe(200);

    const updateByArtifactId = await app.request('/api/tools/live-artifacts/update', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ artifactId: art.data.id, contentType: 'text/plain' }),
    });
    expect(updateByArtifactId.status).toBe(200);

    const updateNoId = await app.request('/api/tools/live-artifacts/update', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'x' }),
    });
    expect(updateNoId.status).toBe(400);

    const updateBadJson = await app.request('/api/tools/live-artifacts/update', {
      method: 'POST',
      headers: auth,
      body: 'not-json',
    });
    expect(updateBadJson.status).toBe(400);

    const updateMissing = await app.request('/api/tools/live-artifacts/update', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', name: 'x' }),
    });
    expect(updateMissing.status).toBe(404);

    const listOverride = await app.request('/api/tools/live-artifacts/list?projectId=other', {
      headers: { Authorization: `Bearer ${tok.data.token}` },
    });
    expect(listOverride.status).toBe(403);

    const refreshNoId = await app.request('/api/tools/live-artifacts/refresh', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(refreshNoId.status).toBe(400);

    const refreshMissing = await app.request('/api/tools/live-artifacts/refresh', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(refreshMissing.status).toBe(404);

    const createFail = await app.request('/api/tools/live-artifacts/create', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '' }),
    });
    expect(createFail.status).toBe(400);
  });
});
