import { afterEach, describe, expect, it } from 'vitest';
import {
  createAgentStep,
  deleteAgentSteps,
  getAgentStep,
  listAgentSteps,
  updateAgentStep,
} from './agent-steps.js';
import { createSession, deleteSession, listSessions } from './sessions.js';

let sessionId: string | null = null;

afterEach(() => {
  if (sessionId) {
    deleteAgentSteps(sessionId);
    deleteSession(sessionId);
    sessionId = null;
  }
  for (const s of listSessions('default')) {
    if (s.title === '_cov_agent_steps') {
      deleteAgentSteps(s.id);
      deleteSession(s.id);
    }
  }
});

describe('agent_step CRUD', () => {
  it('trims ids and rejects blank session lookups', () => {
    expect(getAgentStep('   ')).toBeUndefined();
    expect(listAgentSteps('   ')).toEqual([]);
    expect(updateAgentStep('   ', { status: 'completed' })).toBe(false);
    expect(() =>
      createAgentStep({ sessionId: '  ', stepIndex: 0, type: 'plan' }),
    ).toThrow(/sessionId/i);
  });

  it('creates, lists ordered, updates status/data/error, deletes', () => {
    const session = createSession({ workspaceId: 'default', title: '_cov_agent_steps' });
    sessionId = session.id;

    const s0 = createAgentStep({
      sessionId: session.id,
      stepIndex: 0,
      type: 'plan',
      data: { plan: 'do stuff' },
    });
    expect(s0.status).toBe('pending');
    expect(JSON.parse(s0.data!)).toEqual({ plan: 'do stuff' });

    const s1 = createAgentStep({
      sessionId: session.id,
      stepIndex: 1,
      type: 'tool_use',
    });
    expect(s1.data).toBeNull();

    expect(listAgentSteps(session.id).map((s) => s.step_index)).toEqual([0, 1]);
    expect(getAgentStep(s0.id)?.type).toBe('plan');

    expect(updateAgentStep(s0.id, { status: 'running' })).toBe(true);
    expect(getAgentStep(s0.id)?.status).toBe('running');

    expect(updateAgentStep(s0.id, { status: 'completed', data: { ok: true } })).toBe(true);
    expect(JSON.parse(getAgentStep(s0.id)!.data!)).toEqual({ ok: true });

    expect(updateAgentStep(s1.id, { status: 'error', error: 'boom' })).toBe(true);
    expect(getAgentStep(s1.id)?.error).toBe('boom');

    expect(updateAgentStep('missing-id', { status: 'completed' })).toBe(false);

    deleteAgentSteps(session.id);
    expect(listAgentSteps(session.id)).toEqual([]);
  });
});
