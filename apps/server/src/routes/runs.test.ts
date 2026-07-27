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
});
