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
