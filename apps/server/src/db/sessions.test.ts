import { afterEach, describe, expect, it } from 'vitest';
import {
  addMessage,
  createSession,
  createWorkspace,
  deleteSession,
  deleteWorkspace,
  getSession,
  getWorkspace,
  listMessages,
  listSessions,
  listWorkspaces,
  touchSession,
  updateSessionTitle,
  updateWorkspace,
} from './sessions.js';

const WS_NAME = `_cov_ws_${process.pid}`;

afterEach(() => {
  // clean sessions created under temp workspaces, then workspaces (not default)
  for (const ws of listWorkspaces()) {
    if (ws.name === WS_NAME || ws.id.startsWith('test-')) {
      for (const s of listSessions(ws.id)) {
        deleteSession(s.id);
      }
      if (ws.id !== 'default') deleteWorkspace(ws.id);
    }
  }
  // sessions under default from this suite only (avoid wiping parallel suites)
  for (const s of listSessions('default')) {
    if (
      s.title === '_cov_sess'
      || s.title === '_cov_old'
      || s.title === '_cov_new'
      || s.title === '_cov_msg'
    ) {
      deleteSession(s.id);
    }
  }
});

describe('sessions CRUD', () => {
  it('creates session with defaults and lists by workspace', () => {
    const s = createSession({ workspaceId: 'default', title: '_cov_sess' });
    expect(s.id).toBeTruthy();
    expect(s.provider).toBe('anthropic');
    expect(s.model).toContain('claude');
    expect(s.thinking_mode).toBe('none');
    expect(getSession(s.id)?.title).toBe('_cov_sess');
    expect(listSessions('default').some((x) => x.id === s.id)).toBe(true);
    expect(listSessions().some((x) => x.id === s.id)).toBe(true);
  });

  it('updates title, touches, and deletes session', () => {
    const s = createSession({
      workspaceId: 'default',
      title: '_cov_old',
      provider: 'openai',
      model: 'gpt-4o',
      thinkingMode: 'high',
    });
    expect(s.provider).toBe('openai');
    expect(s.thinking_mode).toBe('high');
    updateSessionTitle(s.id, '_cov_new');
    expect(getSession(s.id)?.title).toBe('_cov_new');
    const before = getSession(s.id)!.updated_at;
    touchSession(s.id);
    const after = getSession(s.id)!.updated_at;
    expect(after >= before).toBe(true);
    expect(deleteSession(s.id)).toBe(true);
    expect(getSession(s.id)).toBeUndefined();
    expect(deleteSession(s.id)).toBe(false);
  });

  it('adds and lists messages with metadata', () => {
    const s = createSession({ workspaceId: 'default', title: '_cov_msg' });
    const m1 = addMessage({ sessionId: s.id, role: 'user', content: 'hello' });
    const m2 = addMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'hi',
      metadata: { tokens: 3 },
    });
    expect(m1.role).toBe('user');
    expect(JSON.parse(m2.metadata!)).toEqual({ tokens: 3 });
    const msgs = listMessages(s.id);
    expect(msgs.map((m) => m.content)).toEqual(['hello', 'hi']);
  });
});

describe('workspaces CRUD', () => {
  it('creates, updates, lists, and protects default', () => {
    const ws = createWorkspace({ name: WS_NAME, path: '/tmp/cov', type: 'local' });
    expect(getWorkspace(ws.id)?.name).toBe(WS_NAME);
    expect(listWorkspaces().some((w) => w.id === ws.id)).toBe(true);

    const updated = updateWorkspace(ws.id, { name: WS_NAME, path: '/tmp/cov2' });
    expect(updated?.path).toBe('/tmp/cov2');
    expect(updateWorkspace('no-such', { name: 'x' })).toBeUndefined();

    expect(deleteWorkspace('default')).toBe(false);
    expect(deleteWorkspace(ws.id)).toBe(true);
    expect(getWorkspace(ws.id)).toBeUndefined();
  });
});
