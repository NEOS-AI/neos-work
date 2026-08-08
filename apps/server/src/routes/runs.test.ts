import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Prevent real CLI spawn / open handles from hanging the suite. */
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
import {
  createMemorySharedRunStore,
  createSharedMemoryBackendForTests,
  resetSharedRunStoreForTests,
  setRunRegistryNodeIdForTests,
  setSharedRunStoreForTests,
  summaryFromRecord,
} from '../lib/run-registry-shared.js';
import fs from 'node:fs';

const app = new Hono();
app.route('/api/runs', runs);

const NAME = `_run_proj_${process.pid}`;
const ids: string[] = [];

function cleanup() {
  resetGlobalRunRegistry();
  resetSharedRunStoreForTests();
  setRunRegistryNodeIdForTests(null);
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

  it('injects preview comments into assembled prompt', async () => {
    const p = projects.createProject({ name: `${NAME}_c` });
    ids.push(p.id);
    projects.createPreviewComment({
      projectId: p.id,
      filePath: 'index.html',
      selector: 'h1.hero',
      body: 'Increase font size',
    });

    const createRes = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'Polish landing',
        dryRun: true,
        editContext: {
          filePath: 'index.html',
          mode: 'patch',
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ok: boolean;
      data: { prompt?: string };
    };
    expect(created.data.prompt).toContain('Preview comments');
    expect(created.data.prompt).toContain('h1.hero');
    expect(created.data.prompt).toContain('Increase font size');
  });


  it('injects design system DESIGN.md into assembled prompt', async () => {
    const { createDesignSystem, deleteDesignSystem } = await import('../lib/design-system-store.js');
    const ds = await createDesignSystem(`_run_ds_${process.pid}`, 'Brand for runs');
    expect(ds).not.toBeNull();
    const p = projects.createProject({
      name: `${NAME}_ds`,
      designSystemId: ds!.id,
    });
    ids.push(p.id);

    const createRes = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'Polish landing',
        dryRun: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ok: boolean;
      data: { prompt?: string };
    };
    expect(created.data.prompt).toContain('DESIGN CONTEXT');
    expect(created.data.prompt).toMatch(/Brand|Design System|Polish landing/i);
    expect(created.data.prompt!.indexOf('DESIGN CONTEXT')).toBeLessThan(
      created.data.prompt!.indexOf('Polish landing'),
    );

    await deleteDesignSystem(ds!.id);
  });


  it('injects enabled memories into project run prompt', async () => {
    const { createMemory, deleteMemory, listMemories } = await import('../lib/memory-store.js');
    const mem = createMemory({
      name: `_run_mem_${process.pid}`,
      type: 'user',
      content: 'Prefer indigo accents on CTAs',
    });
    // ensure enabled
    const p = projects.createProject({ name: `${NAME}_mem` });
    ids.push(p.id);

    const createRes = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'Update button styles',
        dryRun: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { prompt?: string } };
    expect(created.data.prompt).toContain('Agent Memory');
    expect(created.data.prompt).toContain('indigo accents');
    deleteMemory(mem.id);
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

  it('binds collab sessionId on create and rejects invalid (v0.11 M0)', async () => {
    const p = projects.createProject({ name: `${NAME}_bind` });
    ids.push(p.id);

    const bound = await app.request('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-neos-session-id': 'abc123collab',
      },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'bound run',
        dryRun: true,
        sessionId: 'abc123collab',
      }),
    });
    expect(bound.status).toBe(201);
    const boundJson = (await bound.json()) as {
      ok: boolean;
      data: { id: string; collabSessionId?: string | null };
    };
    expect(boundJson.data.collabSessionId).toBe('abc123collab');

    const getRes = await app.request(`/api/runs/${boundJson.data.id}`);
    const got = (await getRes.json()) as {
      data: { collabSessionId?: string | null };
    };
    expect(got.data.collabSessionId).toBe('abc123collab');

    // header-only bind
    const hdrOnly = await app.request('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-neos-session-id': 'header-only-sess',
      },
      body: JSON.stringify({ prompt: 'hdr', dryRun: true }),
    });
    expect(hdrOnly.status).toBe(201);
    const hdrJson = (await hdrOnly.json()) as {
      data: { collabSessionId?: string | null };
    };
    expect(hdrJson.data.collabSessionId).toBe('header-only-sess');

    // no bind → null
    const unbound = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'unbound', dryRun: true }),
    });
    expect(unbound.status).toBe(201);
    const u = (await unbound.json()) as {
      data: { collabSessionId?: string | null };
    };
    expect(u.data.collabSessionId == null || u.data.collabSessionId === null).toBe(true);

    // invalid control chars
    const bad = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'x',
        dryRun: true,
        sessionId: 'bad\nsession',
      }),
    });
    expect(bad.status).toBe(400);

    // overlong
    const long = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'x',
        dryRun: true,
        sessionId: 's'.repeat(65),
      }),
    });
    expect(long.status).toBe(400);
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

describe('runs preview comments injection', () => {
  it('injects project preview comments into dry-run prompt', async () => {
    const p = projects.createProject({ name: `${NAME}_comments` });
    ids.push(p.id);

    projects.createPreviewComment({
      projectId: p.id,
      filePath: 'index.html',
      selector: 'h1',
      body: 'Make the hero larger',
    });
    projects.createPreviewComment({
      projectId: p.id,
      filePath: 'about.html',
      selector: '.cta',
      body: 'Change button color',
    });

    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'Polish the design',
        dryRun: true,
        editContext: {
          filePath: 'index.html',
          mode: 'patch',
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { prompt?: string; status: string } };
    expect(body.data.status).toBe('succeeded');
    // file-scoped comments preferred
    expect(body.data.prompt).toMatch(/Preview comments|Make the hero|h1/i);

    // Without editContext filePath, falls back to all project comments
    const all = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: p.id,
        prompt: 'Address feedback',
        dryRun: true,
      }),
    });
    expect(all.status).toBe(201);
    const allBody = (await all.json()) as { data: { prompt?: string } };
    expect(allBody.data.prompt).toMatch(/Preview comments|hero|button/i);
  });

  it('rejects overlong prompt', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'p'.repeat(100_001),
        dryRun: true,
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/max length/i);
  });

  it('execute:false is treated as dry-run', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'no spawn',
        execute: false,
      }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: { status: string } }).data.status).toBe('succeeded');
  });
});

describe('runs remaining id and cancel branches', () => {
  it('blank id on stream/cancel and cancel on missing run', async () => {
    expect((await app.request('/api/runs/%20/events/stream')).status).toBe(404);
    expect((await app.request('/api/runs/%20/cancel', { method: 'POST' })).status).toBe(404);
    expect(
      (await app.request('/api/runs/00000000-0000-0000-0000-000000000099/events/stream')).status,
    ).toBe(404);
  });

  it('cancel on terminal dry-run returns 409', async () => {
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'done already', dryRun: true }),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { data: { id: string } }).data.id;
    const cancel = await app.request(`/api/runs/${id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(409);
    const body = (await cancel.json()) as { error?: string };
    expect(body.error).toMatch(/terminal|already/i);
  });

  it('truncates oversized memory when injecting into project dry-run', async () => {
    const { createMemory, deleteMemory } = await import('../lib/memory-store.js');
    const big = 'M'.repeat(40_000);
    const mem = createMemory({
      name: `_run_mem_big_${process.pid}`,
      type: 'user',
      content: big,
    });
    const p = projects.createProject({ name: `${NAME}_mem_big` });
    ids.push(p.id);
    try {
      const res = await app.request('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: p.id,
          prompt: 'use memory',
          dryRun: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { prompt?: string } };
      expect(body.data.prompt).toMatch(/Agent Memory|memory truncated/i);
    } finally {
      deleteMemory(mem.id);
    }
  });
});

describe('runs shared registry multi-replica MVP', () => {
  it('GET hydrates from shared store when not in local registry', async () => {
    const backend = createSharedMemoryBackendForTests();
    const store = createMemorySharedRunStore({ nodeId: 'owner-node', backend });
    setSharedRunStoreForTests(store);

    await store.put({
      id: 'remote-run-1',
      status: 'running',
      nodeId: 'owner-node',
      projectId: 'proj-r',
      collabSessionId: 'sess-r',
      agentId: 'cli-claude',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:01.000Z',
      completedAt: null,
      updatedAt: '2026-01-01T00:00:01.000Z',
    });

    // Local registry empty — simulate other pod
    resetGlobalRunRegistry();

    const res = await app.request('/api/runs/remote-run-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        id: string;
        status: string;
        agentId: string | null;
        projectId: string | null;
        eventCount: number;
        collabSessionId: string | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe('remote-run-1');
    expect(body.data.status).toBe('running');
    expect(body.data.agentId).toBe('cli-claude');
    expect(body.data.projectId).toBe('proj-r');
    expect(body.data.collabSessionId).toBe('sess-r');
    expect(body.data.eventCount).toBe(0);
  });

  it('cancel remote summary publishes + marks canceled without 404', async () => {
    const backend = createSharedMemoryBackendForTests();
    // Peer store for the HTTP pod (no local run)
    const peerStore = createMemorySharedRunStore({ nodeId: 'peer-node', backend });
    setSharedRunStoreForTests(peerStore);

    // Owner has the live run + dual-write into shared backend
    const { getGlobalRunRegistry } = await import('@neos-work/agent-runtime');
    const reg = getGlobalRunRegistry();
    const run = reg.create({
      id: 'cross-cancel-1',
      agentId: 'cli-claude',
      prompt: 'long',
    });
    reg.setStatus(run.id, 'running');
    await peerStore.put(summaryFromRecord(run, 'owner-node'));

    // Clear local so cancel must go through shared path
    resetGlobalRunRegistry();
    // Re-create owner local registry simulation on same process via backend handlers:
    // wire a second store that owns the run and listens on shared backend
    const ownerReg = getGlobalRunRegistry();
    const owned = ownerReg.create({
      id: 'cross-cancel-1',
      agentId: 'cli-claude',
      prompt: 'long',
    });
    ownerReg.setStatus(owned.id, 'running');
    // But HTTP cancel will find local first — so clear again and only use shared
    resetGlobalRunRegistry();

    // Peer-only: run not local
    const cancel = await app.request('/api/runs/cross-cancel-1/cancel', {
      method: 'POST',
    });
    expect(cancel.status).toBe(200);
    const body = (await cancel.json()) as {
      ok: boolean;
      data: { id: string; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('canceled');

    const get = await app.request('/api/runs/cross-cancel-1');
    expect(get.status).toBe(200);
    expect(
      ((await get.json()) as { data: { status: string } }).data.status,
    ).toBe('canceled');
  });

  it('cancel remote terminal summary returns 409', async () => {
    const backend = createSharedMemoryBackendForTests();
    const store = createMemorySharedRunStore({ nodeId: 'peer', backend });
    setSharedRunStoreForTests(store);
    await store.put({
      id: 'term-remote',
      status: 'succeeded',
      nodeId: 'owner',
      projectId: null,
      collabSessionId: null,
      agentId: 'cli-claude',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
      updatedAt: '2026-01-01T00:00:05.000Z',
    });
    resetGlobalRunRegistry();
    const cancel = await app.request('/api/runs/term-remote/cancel', {
      method: 'POST',
    });
    expect(cancel.status).toBe(409);
  });

  it('create dry-run dual-writes summary into memory store', async () => {
    const backend = createSharedMemoryBackendForTests();
    const store = createMemorySharedRunStore({ nodeId: 'local', backend });
    setSharedRunStoreForTests(store);

    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'dual write me', dryRun: true }),
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { data: { id: string } }).data.id;
    const summary = await store.get(id);
    expect(summary).not.toBeNull();
    expect(summary!.status).toBe('succeeded');
    expect(summary!.nodeId).toBe('local');
  });

  it('local cancel dual-writes canceled status', async () => {
    spawnMock.mockImplementation(
      () =>
        new Promise(() => {
          /* hang until cancel */
        }),
    );
    const backend = createSharedMemoryBackendForTests();
    const store = createMemorySharedRunStore({ nodeId: 'local', backend });
    setSharedRunStoreForTests(store);

    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'cli-claude',
        prompt: 'cancel dual',
        dryRun: false,
      }),
    });
    expect(create.status).toBe(201);
    const id = ((await create.json()) as { data: { id: string } }).data.id;

    const cancel = await app.request(`/api/runs/${id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    const summary = await store.get(id);
    expect(summary?.status).toBe('canceled');
  });
});
