/**
 * FE↔BE contract smoke (E2): wire formats clients depend on.
 *
 * PR CI: `pnpm e2e:contract` (see `.github/workflows/ci.yml`).
 * Local: `pnpm --filter @neos-work/server exec vitest run src/routes/contract-fe-be.test.ts`
 *
 * Coverage (v0.13):
 * - Live write envelope uses `hash` (not revision `contentHash`)
 * - Lock acquire conflict **409** + `data.holder` (shared parse)
 * - Peers / locks / multi-selection snapshots
 * - Dry-run create + terminal cancel **409**
 * - Agent hard-enforce **423** holder shape (v0.10)
 * - Run `collabSessionId` bind + agent PUT inherit via `runId` (v0.11)
 * - `POST /api/tools/files/write` hash + **423** when locked (v0.11)
 * - Locks snapshot `hardEnforce` / `agentsHardEnforce` flags (v0.13 M1)
 * - Dry-run summary `collabSessionId` body/header/unbound (v0.13 M1)
 *
 * Plan: docs/plans/PLAN_FOR_V0_13_0.md
 */
import fs from 'node:fs';
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
import {
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
} from '@neos-work/agent-runtime';
import {
  collabSelectionsSnapshotSchema,
  parseCollabLockConflict,
  parseCollabLocksSnapshot,
  parseProjectFileWriteResponse,
  parseProjectRunSummaryResponse,
  peerSelectionSchema,
} from '@neos-work/shared';
import projects from './projects.js';
import runs from './runs.js';
import toolsFiles from './tools-files.js';
import { getDb } from '../db/schema.js';
import { clearProjectPresence } from '../lib/project-collab.js';
import { clearToolTokens, issueToolToken } from '../lib/tool-tokens.js';

const app = new Hono();
app.route('/api/projects', projects);
app.route('/api/runs', runs);
app.route('/api/tools/files', toolsFiles);

const NAME = `_contract_fe_be_${process.pid}`;
const createdIds: string[] = [];

function cleanup() {
  resetGlobalRunRegistry();
  clearToolTokens();
  clearProjectPresence();
  const sqlite = getDb();
  for (const id of [
    ...createdIds.splice(0),
    ...((sqlite
      .prepare('SELECT id FROM projects WHERE name LIKE ?')
      .all(`${NAME}%`) as Array<{ id: string }>).map((r) => r.id)),
  ]) {
    const row = sqlite
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockResolvedValue({ output: 'done', exitCode: 0 });
});

afterEach(cleanup);

async function createProject() {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${NAME}_${createdIds.length}` }),
  });
  const json = (await res.json()) as { ok: boolean; data: { id: string } };
  expect(res.status).toBe(201);
  createdIds.push(json.data.id);
  return json.data.id;
}

/** Join collab stream briefly to obtain a real sessionId from ready/self. */
async function joinCollabSession(projectId: string, name: string): Promise<string> {
  const res = await app.request(
    `/api/projects/${projectId}/collab/stream?name=${encodeURIComponent(name)}`,
    { headers: { Accept: 'text/event-stream' } },
  );
  expect(res.ok).toBe(true);
  expect(res.body).toBeTruthy();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let sessionId = '';
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && !sessionId) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // ready: {"sessionId":"..."} or presence.sync self
    const m =
      /"sessionId"\s*:\s*"([a-f0-9]{16,})"/i.exec(buf)
      || /"self"\s*:\s*\{[^}]*"sessionId"\s*:\s*"([a-f0-9]{16,})"/i.exec(buf);
    if (m?.[1]) {
      sessionId = m[1];
      break;
    }
  }
  // abort stream so test can continue
  await reader.cancel().catch(() => {});
  expect(sessionId).toMatch(/^[a-f0-9]+$/i);
  return sessionId;
}

describe('FE↔BE contract smoke', () => {
  it('write file response uses hash (not contentHash)', async () => {
    const id = await createProject();
    const put = await app.request(`/api/projects/${id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '<html><body>contract</body></html>', source: 'user' }),
    });
    expect(put.status).toBe(200);
    const body = await put.json();
    const parsed = parseProjectFileWriteResponse(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.data?.hash.length).toBeGreaterThan(7);
      expect(parsed.data.data?.path).toBe('index.html');
    }
    expect(body).toEqual(expect.objectContaining({ ok: true }));
    expect((body as { data: object }).data).not.toHaveProperty('contentHash');
  });

  it('lock conflict returns 409 with data.holder', async () => {
    const id = await createProject();
    const a = await joinCollabSession(id, 'Alice');
    const b = await joinCollabSession(id, 'Bob');

    const acq = await app.request(`/api/projects/${id}/collab/locks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: a, path: 'index.html', action: 'acquire' }),
    });
    expect(acq.status).toBe(200);
    expect(((await acq.json()) as { ok: boolean }).ok).toBe(true);

    const conflict = await app.request(`/api/projects/${id}/collab/locks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: b, path: 'index.html', action: 'acquire' }),
    });
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    const parsed = parseCollabLockConflict(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.data?.holder?.sessionId).toBe(a);
      expect(typeof parsed.data.data?.holder?.displayName).toBe('string');
    }
  });

  it('GET collab peers and locks snapshots shape', async () => {
    const id = await createProject();
    const sid = await joinCollabSession(id, 'Snap');
    await app.request(`/api/projects/${id}/collab/locks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, path: 'index.html', action: 'acquire' }),
    });

    const peers = await app.request(`/api/projects/${id}/collab/peers`);
    expect(peers.status).toBe(200);
    const peersBody = (await peers.json()) as {
      ok: boolean;
      data: { peers: Array<{ sessionId: string; displayName: string }> };
    };
    expect(peersBody.ok).toBe(true);
    expect(Array.isArray(peersBody.data.peers)).toBe(true);
    expect(peersBody.data.peers.some((p) => p.sessionId === sid)).toBe(true);

    const locks = await app.request(`/api/projects/${id}/collab/locks`);
    expect(locks.status).toBe(200);
    const locksJson = await locks.json();
    const locksParsed = parseCollabLocksSnapshot(locksJson);
    expect(locksParsed.ok).toBe(true);
    if (locksParsed.ok) {
      expect(
        locksParsed.data.data?.locks.some(
          (l) => l.path === 'index.html' && l.sessionId === sid,
        ),
      ).toBe(true);
      // default env: hard-enforce off
      expect(locksParsed.data.data?.hardEnforce).toBe(false);
      expect(locksParsed.data.data?.agentsHardEnforce).toBe(false);
    }
  });

  it('locks snapshot hardEnforce / agentsHardEnforce reflect env (v0.13 M1)', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    process.env.NEOS_SHARED_EDIT_AGENTS = '1';
    try {
      const id = await createProject();
      const locks = await app.request(`/api/projects/${id}/collab/locks`);
      expect(locks.status).toBe(200);
      const parsed = parseCollabLocksSnapshot(await locks.json());
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data.data?.hardEnforce).toBe(true);
        expect(parsed.data.data?.agentsHardEnforce).toBe(true);
      }
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });

  it('dry-run create with session returns collabSessionId on summary (v0.13 M1)', async () => {
    const id = await createProject();
    const sid = await joinCollabSession(id, 'RunSnap');
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-neos-session-id': sid,
      },
      body: JSON.stringify({
        projectId: id,
        prompt: 'summary bind',
        dryRun: true,
        sessionId: sid,
      }),
    });
    expect([200, 201]).toContain(create.status);
    const body = await create.json();
    const parsed = parseProjectRunSummaryResponse(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.data?.collabSessionId).toBe(sid);
      expect(parsed.data.data?.id).toBeTruthy();
      expect(typeof parsed.data.data?.status).toBe('string');
    }

    // header-only bind
    const hdrOnly = await app.request('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-neos-session-id': sid,
      },
      body: JSON.stringify({ prompt: 'header only', dryRun: true }),
    });
    expect([200, 201]).toContain(hdrOnly.status);
    const hdrParsed = parseProjectRunSummaryResponse(await hdrOnly.json());
    expect(hdrParsed.ok).toBe(true);
    if (hdrParsed.ok) {
      expect(hdrParsed.data.data?.collabSessionId).toBe(sid);
    }

    // no bind → null / absent
    const unbound = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'unbound', dryRun: true }),
    });
    expect([200, 201]).toContain(unbound.status);
    const u = parseProjectRunSummaryResponse(await unbound.json());
    expect(u.ok).toBe(true);
    if (u.ok) {
      const cid = u.data.data?.collabSessionId;
      expect(cid == null || cid === null).toBe(true);
    }
  });

  it('collab multi-selection publish + GET selections snapshot shape', async () => {
    const id = await createProject();
    const sid = await joinCollabSession(id, 'MultiSel');

    const publish = await app.request(`/api/projects/${id}/collab/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        path: 'index.html',
        selector: '#primary',
        layerId: 'layer-primary',
        selectors: ['#a', '#b', '#primary'],
        layerIds: ['layer-a', 'layer-b', 'layer-primary'],
      }),
    });
    expect(publish.status).toBe(200);
    const published = (await publish.json()) as {
      ok: boolean;
      data: { selection: unknown };
    };
    expect(published.ok).toBe(true);
    const one = peerSelectionSchema.safeParse(published.data.selection);
    expect(one.success).toBe(true);
    if (one.success) {
      expect(one.data.sessionId).toBe(sid);
      expect(one.data.path).toBe('index.html');
      expect(one.data.selector).toBe('#primary');
      expect(one.data.selectors).toEqual(['#a', '#b', '#primary']);
      expect(one.data.layerIds).toEqual(['layer-a', 'layer-b', 'layer-primary']);
    }

    const snap = await app.request(`/api/projects/${id}/collab/selections`);
    expect(snap.status).toBe(200);
    const snapBody = await snap.json();
    const parsed = collabSelectionsSnapshotSchema.safeParse(snapBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const mine = parsed.data.data.selections.find((s) => s.sessionId === sid);
      expect(mine).toBeTruthy();
      expect(mine?.selectors).toEqual(expect.arrayContaining(['#a', '#primary']));
      expect(mine?.layerIds?.length).toBe(3);
    }
  });

  it('dry-run create + cancel terminal returns 409', async () => {
    const create = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'contract dry', dryRun: true }),
    });
    expect([200, 201]).toContain(create.status);
    const created = (await create.json()) as {
      ok: boolean;
      data: { id: string; status: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.id).toBeTruthy();

    // dry-run usually finishes immediately
    const cancel1 = await app.request(`/api/runs/${created.data.id}/cancel`, {
      method: 'POST',
    });
    // either cancels (if still running) or 409 terminal
    if (cancel1.status === 200) {
      const body = (await cancel1.json()) as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
      expect(['canceled', 'cancelled', 'succeeded', 'failed']).toContain(body.data.status);
    } else {
      expect(cancel1.status).toBe(409);
      const body = (await cancel1.json()) as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
    }

    // second cancel on terminal must be 409
    const cancel2 = await app.request(`/api/runs/${created.data.id}/cancel`, {
      method: 'POST',
    });
    expect(cancel2.status).toBe(409);
    const body2 = (await cancel2.json()) as { ok: boolean };
    expect(body2.ok).toBe(false);
  });

  /**
   * v0.10–v0.11 shared-edit wire (v0.13 M0) — agent 423, run bind, tools/files.
   * Kept in this suite so `pnpm e2e:contract` (PR CI) protects the train.
   */
  it('agent hard-enforce 423 holder shape when both shared-edit flags on', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    process.env.NEOS_SHARED_EDIT_AGENTS = '1';
    try {
      const id = await createProject();
      await app.request(`/api/projects/${id}/files/locked.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'v1', source: 'user' }),
      });
      const holder = await joinCollabSession(id, 'ContractHolder');
      const acq = await app.request(`/api/projects/${id}/collab/locks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: holder,
          path: 'locked.html',
          action: 'acquire',
        }),
      });
      expect(acq.status).toBe(200);

      const blocked = await app.request(`/api/projects/${id}/files/locked.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'agent', source: 'agent' }),
      });
      expect(blocked.status).toBe(423);
      const body = await blocked.json();
      const parsed = parseCollabLockConflict(body);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data.data?.holder?.sessionId).toBe(holder);
        expect(typeof parsed.data.data?.holder?.displayName).toBe('string');
      }
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });

  it('run collabSessionId bind + agent PUT inherit via runId', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    process.env.NEOS_SHARED_EDIT_AGENTS = '1';
    try {
      const id = await createProject();
      await app.request(`/api/projects/${id}/files/bind.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'v1', source: 'user' }),
      });
      const holder = await joinCollabSession(id, 'BindHolder');
      expect(
        (
          await app.request(`/api/projects/${id}/collab/locks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: holder,
              path: 'bind.html',
              action: 'acquire',
            }),
          })
        ).status,
      ).toBe(200);

      const create = await app.request('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-neos-session-id': holder,
        },
        body: JSON.stringify({
          projectId: id,
          prompt: 'bound contract',
          dryRun: true,
          sessionId: holder,
        }),
      });
      expect([200, 201]).toContain(create.status);
      const created = await create.json();
      const runParsed = parseProjectRunSummaryResponse(created);
      expect(runParsed.ok).toBe(true);
      if (runParsed.ok) {
        expect(runParsed.data.data?.collabSessionId).toBe(holder);
        expect(runParsed.data.data?.id).toBeTruthy();
      }
      const runId =
        runParsed.ok && runParsed.data.data?.id
          ? runParsed.data.data.id
          : (created as { data: { id: string } }).data.id;

      // Also ensure registry has bind (dry-run still stores collabSessionId)
      const regRun = getGlobalRunRegistry().get(runId);
      expect(regRun?.collabSessionId).toBe(holder);

      const viaRun = await app.request(`/api/projects/${id}/files/bind.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'from-bound-run',
          source: 'agent',
          runId,
        }),
      });
      expect(viaRun.status).toBe(200);
      const writeBody = await viaRun.json();
      expect(parseProjectFileWriteResponse(writeBody).ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });

  it('tools/files write: hash success + 423 when locked without session', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    process.env.NEOS_SHARED_EDIT_AGENTS = '1';
    try {
      const id = await createProject();
      const tok = issueToolToken({
        projectId: id,
        capabilities: ['files'],
      });

      const ok = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok.token}`,
        },
        body: JSON.stringify({ path: 'tool.html', content: '<p>ok</p>' }),
      });
      expect(ok.status).toBe(200);
      const okBody = await ok.json();
      expect(parseProjectFileWriteResponse(okBody).ok).toBe(true);

      const holder = await joinCollabSession(id, 'ToolLock');
      expect(
        (
          await app.request(`/api/projects/${id}/collab/locks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: holder,
              path: 'tool.html',
              action: 'acquire',
            }),
          })
        ).status,
      ).toBe(200);

      const blocked = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok.token}`,
        },
        body: JSON.stringify({ path: 'tool.html', content: 'blocked' }),
      });
      expect(blocked.status).toBe(423);
      expect(parseCollabLockConflict(await blocked.json()).ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });
});
