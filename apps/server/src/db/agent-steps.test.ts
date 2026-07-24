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

  it('rejects invalid type/stepIndex and normalizes type case', () => {
    const session = createSession({ workspaceId: 'default', title: '_cov_agent_steps' });
    sessionId = session.id;
    expect(() =>
      createAgentStep({ sessionId: session.id, stepIndex: 0, type: 'nope' as never }),
    ).toThrow(/type must be/i);
    expect(() =>
      createAgentStep({ sessionId: session.id, stepIndex: -1, type: 'plan' }),
    ).toThrow(/stepIndex/i);
    const s = createAgentStep({
      sessionId: `  ${session.id}  `,
      stepIndex: 2.9,
      type: '  PLAN  ' as never,
    });
    expect(s.type).toBe('plan');
    expect(s.step_index).toBe(2);
    expect(updateAgentStep(s.id, { status: '  COMPLETED  ' as never })).toBe(true);
    expect(getAgentStep(s.id)?.status).toBe('completed');
    expect(updateAgentStep(s.id, { status: 'pendingish' as never })).toBe(false);
  });

  it('accepts all step types and ignores blank session delete', () => {
    const session = createSession({ workspaceId: 'default', title: '_cov_agent_steps' });
    sessionId = session.id;
    const types = ['plan', 'tool_use', 'tool_result', 'reasoning', 'error'] as const;
    for (let i = 0; i < types.length; i++) {
      const s = createAgentStep({
        sessionId: session.id,
        stepIndex: i,
        type: types[i]!,
      });
      expect(s.type).toBe(types[i]);
    }
    expect(listAgentSteps(session.id)).toHaveLength(5);
    deleteAgentSteps('   '); // no-op
    expect(listAgentSteps(session.id)).toHaveLength(5);
    deleteAgentSteps(session.id);
    expect(listAgentSteps(session.id)).toEqual([]);
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

    // blank status rejected; error trim
    expect(updateAgentStep(s0.id, { status: '   ' as never })).toBe(false);
    expect(getAgentStep(s0.id)?.status).toBe('completed');
    expect(updateAgentStep(s1.id, { error: '  boom2  ' })).toBe(true);
    expect(getAgentStep(s1.id)?.error).toBe('boom2');

    deleteAgentSteps(session.id);
    expect(listAgentSteps(session.id)).toEqual([]);
  });
});
