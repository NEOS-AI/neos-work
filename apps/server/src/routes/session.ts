import { Hono } from 'hono';

import type { ApiResponse, CreateSessionRequest, Session } from '@neos-work/shared';

const session = new Hono();

// TODO: Replace with SQLite persistence in Phase 2
const sessions = new Map<string, Session>();

session.get('/', (c) => {
  const all = Array.from(sessions.values());
  const response: ApiResponse<Session[]> = { ok: true, data: all };
  return c.json(response);
});

session.post('/', async (c) => {
  const body = await c.req.json<CreateSessionRequest>();
  const now = new Date().toISOString();
  const newSession: Session = {
    id: crypto.randomUUID(),
    workspaceId: body.workspaceId,
    title: body.title ?? null,
    provider: (body.provider as Session['provider']) ?? 'anthropic',
    model: body.model ?? 'claude-opus-4-6',
    thinkingMode: 'medium',
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(newSession.id, newSession);
  const response: ApiResponse<Session> = { ok: true, data: newSession };
  return c.json(response, 201);
});

session.get('/:id', (c) => {
  const id = c.req.param('id');
  const s = sessions.get(id);
  if (!s) {
    const response: ApiResponse<never> = { ok: false, error: 'Session not found' };
    return c.json(response, 404);
  }
  return c.json({ ok: true, data: s });
});

session.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = sessions.delete(id);
  if (!deleted) {
    return c.json({ ok: false, error: 'Session not found' }, 404);
  }
  return c.json({ ok: true });
});

export { session };
