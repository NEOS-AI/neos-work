/**
 * FE↔BE contract smoke (E2): wire formats clients depend on.
 * Run: pnpm --filter @neos-work/server exec vitest run src/routes/contract-fe-be.test.ts
 *      pnpm e2e:contract
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
import { resetGlobalRunRegistry } from '@neos-work/agent-runtime';
import {
  parseCollabLockConflict,
  parseProjectFileWriteResponse,
} from '@neos-work/shared';
import projects from './projects.js';
import runs from './runs.js';
import { getDb } from '../db/schema.js';
import { clearProjectPresence } from '../lib/project-collab.js';

const app = new Hono();
app.route('/api/projects', projects);
app.route('/api/runs', runs);

const NAME = `_contract_fe_be_${process.pid}`;
const createdIds: string[] = [];

function cleanup() {
  resetGlobalRunRegistry();
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
    const locksBody = (await locks.json()) as {
      ok: boolean;
      data: { locks: Array<{ path: string; sessionId: string; displayName: string }> };
    };
    expect(locksBody.ok).toBe(true);
    expect(locksBody.data.locks.some((l) => l.path === 'index.html' && l.sessionId === sid)).toBe(
      true,
    );
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
});
