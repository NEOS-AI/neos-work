import { afterEach, describe, expect, it } from 'vitest';
import { listSessions, deleteSession } from '../db/sessions.js';
import { models, session, workspace } from './session.js';

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
    const badJson = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

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

  it('rejects invalid thinkingMode and accepts valid ones', async () => {
    const bad = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        title: TITLE,
        thinkingMode: 'ultra',
      }),
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json() as { error: string };
    expect(badBody.error).toMatch(/thinkingMode/i);

    const create = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        title: TITLE,
        thinkingMode: '  high  ',
        provider: 'anthropic',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; thinking_mode?: string } };
    expect(created.data.thinking_mode).toBe('high');
    await session.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('trims workspaceId/title and rejects blank title when provided', async () => {
    const blankTitle = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'default', title: '   ' }),
    });
    expect(blankTitle.status).toBe(400);

    const create = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: '  default  ',
        title: `  ${TITLE}  `,
        provider: '  Anthropic  ',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; title: string | null; workspaceId?: string } };
    expect(created.data.title).toBe(TITLE);

    const badConfirm = await session.request(`/${created.data.id}/tool-confirm/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badConfirm.status).toBe(400);

    const missingConfirm = await session.request(`/${created.data.id}/tool-confirm/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    expect(missingConfirm.status).toBe(404);

    await session.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('trims list workspaceId query and blank path ids', async () => {
    const blankWs = await session.request('/?workspaceId=%20%20');
    expect(blankWs.status).toBe(200);
    const all = await blankWs.json() as { ok: boolean; data: unknown[] };
    expect(all.ok).toBe(true);
    expect(Array.isArray(all.data)).toBe(true);

    const trimmed = await session.request('/?workspaceId=%20default%20');
    expect(trimmed.status).toBe(200);

    const blankGet = await session.request('/%20');
    expect(blankGet.status).toBe(404);
    const blankMsgs = await session.request('/%20/messages');
    expect(blankMsgs.status).toBe(404);
    const blankDel = await session.request('/%20', { method: 'DELETE' });
    expect(blankDel.status).toBe(404);
    const blankCancel = await session.request('/%20/cancel', { method: 'POST' });
    expect(blankCancel.status).toBe(404);
  });

  it('chat and agent reject invalid JSON / empty content before LLM', async () => {
    const create = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        title: `${TITLE}-msg`,
        provider: 'anthropic',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };
    const id = created.data.id;

    const chatBadJson = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    // May hit "No API key" (400) first when keys missing, or Invalid JSON
    expect(chatBadJson.status).toBe(400);

    const chatEmpty = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });
    expect(chatEmpty.status).toBe(400);

    const agentBadJson = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(agentBadJson.status).toBe(400);

    const agentEmpty = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    expect(agentEmpty.status).toBe(400);

    const missing = await session.request('/no-such-session/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    expect(missing.status).toBe(404);

    const missingAgent = await session.request('/no-such-session/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    expect(missingAgent.status).toBe(404);

    const oversized = 'x'.repeat(100_001);
    const chatOver = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: oversized }),
    });
    expect(chatOver.status).toBe(400);
    const chatOverBody = await chatOver.json() as { error: string };
    // May be API key missing or max length depending on settings; both are 400 validation.
    expect(chatOverBody.error).toMatch(/max length|API key/i);

    const agentOver = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: oversized }),
    });
    expect(agentOver.status).toBe(400);

    const blankToolId = await session.request(`/${id}/tool-confirm/%20%20`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    expect(blankToolId.status).toBe(404);

    const invalidApproved = await session.request(`/${id}/tool-confirm/some-id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: 'yes' }),
    });
    expect(invalidApproved.status).toBe(400);

    await session.request(`/${id}`, { method: 'DELETE' });
  });

  it('rejects invalid workspaceId length and non-string content on create', async () => {
    const longWs = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'w'.repeat(101), title: TITLE }),
    });
    expect(longWs.status).toBe(400);

    const longTitle = await session.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'default',
        title: 't'.repeat(201),
      }),
    });
    expect(longTitle.status).toBe(400);
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

  it('trims name/path and rejects blank name', async () => {
    const blank = await workspace.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blank.status).toBe(400);

    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const homePath = join(homedir(), 'neos-cov-ws');
    const create = await workspace.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '  Cov Workspace  ',
        path: `  ${homePath}  `,
        type: '  local  ',
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; name: string; path?: string } };
    expect(created.data.name).toBe('Cov Workspace');
    expect(created.data.path).toBe(homePath);
    await workspace.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('rejects path outside home', async () => {
    const res = await workspace.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Path', path: '/tmp/outside-home' }),
    });
    expect(res.status).toBe(400);
  });

  it('updates workspace name/path via PUT and validates body', async () => {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const homePath = join(homedir(), 'neos-cov-ws-put');
    const create = await workspace.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cov Put WS', path: homePath }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };
    const id = created.data.id;

    const badJson = await workspace.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const blankName = await workspace.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blankName.status).toBe(400);

    const badPath = await workspace.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/outside' }),
    });
    expect(badPath.status).toBe(400);

    const newPath = join(homedir(), 'neos-cov-ws-put-2');
    const put = await workspace.request(`/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Renamed WS  ', path: `  ${newPath}  ` }),
    });
    expect(put.status).toBe(200);
    const updated = await put.json() as { data: { name: string; path?: string } };
    expect(updated.data.name).toBe('Renamed WS');
    expect(updated.data.path).toBe(newPath);

    const missing = await workspace.request('/no-such-ws', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(missing.status).toBe(404);

    const blankId = await workspace.request('/%20', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(blankId.status).toBe(404);

    await workspace.request(`/${id}`, { method: 'DELETE' });
  });
});

describe('models route', () => {
  it('lists registry models (empty without keys; populated when key set)', async () => {
    const empty = await models.request('/');
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json() as { ok: boolean; data: unknown[] };
    expect(emptyBody.ok).toBe(true);
    expect(Array.isArray(emptyBody.data)).toBe(true);

    // Seed a dummy anthropic key so registry registers the adapter
    const { setSetting, deleteSetting } = await import('../db/settings.js');
    setSetting('apiKey.anthropic', 'sk-test-models-route');
    try {
      const res = await models.request('/');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<{ id: string }> };
      expect(body.ok).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
    } finally {
      deleteSetting('apiKey.anthropic');
    }
  });
});
