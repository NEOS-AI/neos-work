import { afterEach, describe, expect, it } from 'vitest';
import { listSessions, deleteSession } from '../db/sessions.js';
import { session, workspace } from './session.js';

const TITLE = `_cov_sess_route_${process.pid}`;

afterEach(() => {
  for (const s of listSessions('default')) {
    if (s.title === TITLE || s.title === `${TITLE}-msg`) {
      deleteSession(s.id);
    }
  }
});

describe('session routes', () => {
  it('lists sessions', async () => {
    const res = await session.request('/?workspaceId=default');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('creates, gets, lists messages, deletes', async () => {
    const bad = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);

    const create = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        title: TITLE,
        provider: 'anthropic',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; title: string | null } };
    const id = created.data.id;

    const get = await session.request(`/${id}`);
    expect(get.status).toBe(200);

    const msgs = await session.request(`/${id}/messages`);
    expect(msgs.status).toBe(200);
    const msgBody = await msgs.json() as { data: unknown[] };
    expect(msgBody.data).toEqual([]);

    const cancel = await session.request(`/${id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(404);

    const del = await session.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await session.request(`/${id}`);
    expect(missing.status).toBe(404);
  });

  it('rejects invalid provider and model', async () => {
    const badProv = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', provider: 'openai-bad' }),
    });
    expect(badProv.status).toBe(400);

    const badModel = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', model: 'not-a-real-model-xyz' }),
    });
    expect(badModel.status).toBe(400);
  });
});

describe('workspace routes', () => {
  it('lists workspaces and protects default delete', async () => {
    const list = await workspace.request('/');
    expect(list.status).toBe(200);
    const body = await list.json() as { data: Array<{ id: string }> };
    expect(body.data.some((w) => w.id === 'default')).toBe(true);

    const del = await workspace.request('/default', { method: 'DELETE' });
    expect(del.status).toBe(400);
  });

  it('rejects path outside home', async () => {
    const res = await workspace.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Path', path: '/tmp/outside-home' }),
    });
    expect(res.status).toBe(400);
  });
});
