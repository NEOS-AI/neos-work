/**
 * Cover live CLI execute path for runs without hanging real processes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() =>
  vi.fn(async () => ({ output: 'done', exitCode: 0 })),
);

vi.mock('../lib/registry-spawn.js', () => ({
  spawnRegistryAgent: (...args: unknown[]) => spawnMock(...args),
  isLegacyCliId: (id: string) =>
    id === 'cli-claude' || id === 'cli-gemini' || id === 'cli-codex',
  loadAllPathOverrides: () => ({}),
}));

import { Hono } from 'hono';
import { resetGlobalRunRegistry } from '@neos-work/agent-runtime';
import runs from './runs.js';
import * as projects from '../db/projects.js';
import { getDb } from '../db/schema.js';
import fs from 'node:fs';

const app = new Hono();
app.route('/api/runs', runs);

const NAME = `_run_exec_${process.pid}`;
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
beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockResolvedValue({ output: 'done', exitCode: 0 });
});

describe('runs live execute (mocked spawn)', () => {
  it('spawns CLI and marks run succeeded', async () => {
    const p = projects.createProject({ name: NAME });
    ids.push(p.id);

    // write a file so files_changed can detect new ones after spawn
    fs.writeFileSync(`${p.baseDir}/index.html`, '<html>old</html>');

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        agentId: 'cli-claude',
        prompt: 'edit hero',
        dryRun: false,
      }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as { data: { id: string; status: string } };
    expect(body.data.status).toBe('running');

    // wait for background executeCliRun
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const get = await app.request(`/api/runs/${body.data.id}`);
      const st = ((await get.json()) as { data: { status: string } }).data.status;
      if (st === 'succeeded' || st === 'failed') {
        expect(st).toBe('succeeded');
        break;
      }
      if (i === 39) expect(st).toBe('succeeded');
    }

    expect(spawnMock).toHaveBeenCalled();
    const call = spawnMock.mock.calls[0]?.[0] as { agentId: string; projectId?: string };
    expect(call.agentId).toBe('cli-claude');
    expect(call.projectId).toBe(p.id);
  });

  it('marks failed when spawn rejects', async () => {
    spawnMock.mockRejectedValueOnce(new Error('spawn boom'));
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'fail please',
      }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    let status = 'running';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const get = await app.request(`/api/runs/${id}`);
      status = ((await get.json()) as { data: { status: string } }).data.status;
      if (status !== 'running') break;
    }
    expect(status).toBe('failed');
  });

  it('marks failed on non-zero exit code', async () => {
    spawnMock.mockResolvedValueOnce({ output: 'err', exitCode: 2 });
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'exit two',
      }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    let status = 'running';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const get = await app.request(`/api/runs/${id}`);
      status = ((await get.json()) as { data: { status: string } }).data.status;
      if (status !== 'running') break;
    }
    expect(status).toBe('failed');
  });

  it('cancel aborts a running execute', async () => {
    spawnMock.mockImplementation(
      () =>
        new Promise(() => {
          /* hang until cancel */
        }),
    );

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'long running',
      }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const cancel = await app.request(`/api/runs/${id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    const body = (await cancel.json()) as { data: { status: string } };
    expect(body.data.status).toBe('canceled');
  });

  it('emits files_changed when project gains files during spawn', async () => {
    const p = projects.createProject({ name: `${NAME}_fc` });
    ids.push(p.id);
    fs.writeFileSync(`${p.baseDir}/index.html`, '<html>old</html>');

    spawnMock.mockImplementation(async () => {
      fs.writeFileSync(`${p.baseDir}/new-from-cli.html`, '<html>new</html>');
      return { output: 'created', exitCode: 0 };
    });

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        agentId: 'cli-claude',
        prompt: 'create file',
        dryRun: false,
      }),
    });
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    let status = 'running';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const get = await app.request(`/api/runs/${id}`);
      status = ((await get.json()) as { data: { status: string } }).data.status;
      if (status !== 'running') break;
    }
    expect(status).toBe('succeeded');

    const ev = await app.request(`/api/runs/${id}/events`);
    const evBody = (await ev.json()) as {
      data: Array<{ type: string; data?: { paths?: string[] } }>;
    };
    const changed = evBody.data.find((e) => e.type === 'run.files_changed');
    expect(changed).toBeTruthy();
    expect(changed?.data?.paths?.some((x) => x.includes('new-from-cli'))).toBe(true);
  });

  it('rejects unknown agentId at create and emits modified files_changed on edit', async () => {
    const unknown = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-does-not-exist-xyz',
        prompt: 'nope',
        dryRun: false,
      }),
    });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toMatch(/Unknown agentId/i);

    // modified path: rewrite existing file during spawn
    const p = projects.createProject({ name: `${NAME}_mod` });
    ids.push(p.id);
    const target = `${p.baseDir}/index.html`;
    fs.writeFileSync(target, '<html>v1</html>');
    const old = fs.statSync(target).mtimeMs;
    spawnMock.mockImplementation(async (opts: { onChunk?: (c: string) => void }) => {
      opts.onChunk?.('partial-out');
      fs.writeFileSync(target, '<html>v2-changed</html>');
      try {
        fs.utimesSync(target, new Date(), new Date(old + 60_000));
      } catch {
        /* ignore */
      }
      return { output: 'edited', exitCode: 0 };
    });

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        agentId: 'cli-claude',
        prompt: 'edit file',
        dryRun: false,
      }),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { data: { id: string } }).data.id;
    let status = 'running';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const get = await app.request(`/api/runs/${id}`);
      status = ((await get.json()) as { data: { status: string } }).data.status;
      if (status !== 'running') break;
    }
    expect(status).toBe('succeeded');
    const ev = await app.request(`/api/runs/${id}/events`);
    const events = ((await ev.json()) as {
      data: Array<{ type: string; data?: { kind?: string; chunk?: string } }>;
    }).data;
    expect(events.some((e) => e.type === 'run.stdout')).toBe(true);
  });
});
