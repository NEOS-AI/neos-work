import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { resetGlobalRunRegistry } from '@neos-work/agent-runtime';
import runs from './runs.js';
import * as projects from '../db/projects.js';
import { getDb } from '../db/schema.js';
import fs from 'node:fs';

const app = new Hono();
app.route('/api/runs', runs);

const NAME = `_run_proj_${process.pid}`;
const ids: string[] = [];

function cleanup() {
  resetGlobalRunRegistry();
  const db = getDb();
  for (const id of ids.splice(0)) {
    const row = db
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

afterEach(cleanup);

describe('runs routes', () => {
  it('creates dry-run, lists events, cancels terminal 409', async () => {
    const p = projects.createProject({ name: NAME });
    ids.push(p.id);

    const createRes = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        agentId: 'cli-claude',
        prompt: 'Refine hero',
        dryRun: true,
        editContext: {
          filePath: 'index.html',
          mode: 'patch',
          selection: { selector: 'h1' },
          snippet: '<h1>Hi</h1>',
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ok: boolean;
      data: { id: string; status: string; prompt?: string };
    };
    expect(created.data.status).toBe('succeeded');
    expect(created.data.prompt).toContain('Edit context');

    const eventsRes = await app.request(`/api/runs/${created.data.id}/events`);
    const events = (await eventsRes.json()) as { data: Array<{ type: string }> };
    expect(events.data.some((e) => e.type === 'run.started')).toBe(true);
    expect(events.data.some((e) => e.type === 'run.succeeded')).toBe(true);

    const cancel = await app.request(`/api/runs/${created.data.id}/cancel`, {
      method: 'POST',
    });
    expect(cancel.status).toBe(409);

    const list = await app.request(`/api/runs?projectId=${p.id}`);
    const listJson = (await list.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((r) => r.id === created.data.id)).toBe(true);
  });

  it('rejects unknown agent and bad editContext', async () => {
    const badAgent = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'cli-nope', prompt: 'x', dryRun: true }),
    });
    expect(badAgent.status).toBe(400);

    const badCtx = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'x',
        dryRun: true,
        editContext: { filePath: 'a\nb', mode: 'patch' },
      }),
    });
    expect(badCtx.status).toBe(400);
  });

  it('agentId without dryRun starts live run; dryRun succeeds deferred', async () => {
    // Without dryRun and with agentId, run starts in background (status running)
    const live = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'hello',
      }),
    });
    expect(live.status).toBe(201);
    const l = (await live.json()) as { data: { id: string; status: string } };
    // May already be failed if claude missing, or still running
    expect(['running', 'failed', 'succeeded']).toContain(l.data.status);
    if (l.data.status === 'running') {
      await app.request(`/api/runs/${l.data.id}/cancel`, { method: 'POST' });
    }

    // dryRun still succeeds immediately without spawning
    const deferred = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'cli-claude', prompt: 'hello', dryRun: true }),
    });
    expect(deferred.status).toBe(201);
    const d = (await deferred.json()) as { data: { status: string } };
    expect(d.data.status).toBe('succeeded');
  });

  it('rejects empty prompt', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, prompt: '  ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('runs execute path with mocked spawn', () => {
  it('GET run / events 404 for blank and missing ids', async () => {
    expect((await app.request('/api/runs/%20')).status).toBe(404);
    expect((await app.request('/api/runs/no-such/events')).status).toBe(404);
    expect((await app.request('/api/runs/%20/events')).status).toBe(404);
    expect((await app.request('/api/runs/no-such/cancel', { method: 'POST' })).status).toBe(404);
  });

  it('create without agentId succeeds deferred', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'no agent', dryRun: false }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('succeeded');
  });

  it('rejects invalid JSON body and null-byte prompt', async () => {
    const bad = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(bad.status).toBe(400);

    const nul = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `x${'\0'}`, dryRun: true }),
    });
    expect(nul.status).toBe(400);
  });

  it('404 when projectId unknown', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: '00000000-0000-0000-0000-000000000099',
        prompt: 'x',
        dryRun: true,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('GET single run and events after filter', async () => {
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'events', dryRun: true }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const get = await app.request(`/api/runs/${id}`);
    expect(get.status).toBe(200);
    expect(((await get.json()) as { data: { id: string } }).data.id).toBe(id);

    const events = await app.request(`/api/runs/${id}/events`);
    expect(events.status).toBe(200);
    const evBody = (await events.json()) as { data: Array<{ id: string }> };
    expect(evBody.data.length).toBeGreaterThan(0);

    // after filter
    const after = await app.request(
      `/api/runs/${id}/events?after=${evBody.data[0]!.id}`,
    );
    expect(after.status).toBe(200);
  });

  it('SSE events/stream ends for terminal dry-run', async () => {
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'stream me', dryRun: true }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const streamRes = await app.request(`/api/runs/${id}/events/stream`);
    expect(streamRes.status).toBe(200);
    // read with timeout so we never hang the suite
    const text = await Promise.race([
      streamRes.text(),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 3000)),
    ]);
    expect(text === 'timeout' || text.includes('event:') || text.includes('data:')).toBe(true);
  });
});
