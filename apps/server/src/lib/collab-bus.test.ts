import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCollabBus,
  isCollabBusFanoutEvent,
  resetCollabBusForTests,
  resolveCollabBusKind,
  initCollabBus,
  getCollabBus,
} from './collab-bus.js';
import {
  applyRemoteCollabEvent,
  clearProjectPresence,
  joinProjectPresence,
  listProjectLocks,
} from './project-collab.js';
import type { CollabEvent } from './collab-types.js';

describe('collab-bus', () => {
  afterEach(() => {
    resetCollabBusForTests();
    clearProjectPresence();
  });

  it('resolveCollabBusKind defaults to memory', () => {
    expect(resolveCollabBusKind({})).toBe('memory');
    expect(resolveCollabBusKind({ NEOS_COLLAB_BUS: 'redis' })).toBe('redis');
    expect(resolveCollabBusKind({ NEOS_COLLAB_BUS: 'MEMORY' })).toBe('memory');
  });

  it('isCollabBusFanoutEvent excludes presence.sync', () => {
    expect(
      isCollabBusFanoutEvent({
        type: 'presence.sync',
        projectId: 'p',
        self: {
          sessionId: 's',
          displayName: 'A',
          joinedAt: '',
          colorHint: 0,
        },
        peers: [],
        locks: [],
        ts: '',
      }),
    ).toBe(false);
    expect(
      isCollabBusFanoutEvent({
        type: 'presence.join',
        projectId: 'p',
        peer: { sessionId: 's', displayName: 'A', joinedAt: '', colorHint: 1 },
        ts: '',
      }),
    ).toBe(true);
  });

  it('memory bus delivers to subscribers with originNodeId', () => {
    const bus = createCollabBus({ NEOS_COLLAB_BUS: 'memory' });
    const seen: string[] = [];
    bus.subscribe((env) => {
      seen.push(env.originNodeId);
      expect(env.projectId).toBe('proj');
      expect(env.event.type).toBe('presence.join');
    });
    bus.publish('proj', {
      type: 'presence.join',
      projectId: 'proj',
      peer: { sessionId: 's1', displayName: 'A', joinedAt: 't', colorHint: 1 },
      ts: 't',
    });
    expect(seen).toEqual([bus.nodeId]);
    expect(bus.status().kind).toBe('memory');
    expect(bus.status().ready).toBe(true);
    bus.close();
  });

  it('redis without URL is redis-stub and still local-publishes', () => {
    const bus = createCollabBus({ NEOS_COLLAB_BUS: 'redis' });
    expect(bus.status().kind).toBe('redis-stub');
    const fn = vi.fn();
    bus.subscribe(fn);
    bus.publish('p', {
      type: 'lock.released',
      projectId: 'p',
      path: 'a.html',
      sessionId: 's',
      ts: 't',
    });
    expect(fn).toHaveBeenCalled();
    bus.close();
  });

  it('initCollabBus wires remote apply without loop on self origin', () => {
    const bus = initCollabBus((pid, ev) => {
      applyRemoteCollabEvent(pid, ev);
    }, { NEOS_COLLAB_BUS: 'memory' });

    const listener = vi.fn();
    joinProjectPresence({ projectId: 'p1', displayName: 'Local', listener });

    // Simulate remote envelope (different origin)
    const remoteJoin: CollabEvent = {
      type: 'presence.join',
      projectId: 'p1',
      peer: { sessionId: 'remote1', displayName: 'Remote', joinedAt: 't', colorHint: 9 },
      ts: 't',
    };
    // Directly invoke as if from another node
    applyRemoteCollabEvent('p1', remoteJoin);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'presence.join' }));

    // Self publish should not double-apply via bus handler (origin skip)
    const before = listener.mock.calls.length;
    getCollabBus().publish('p1', remoteJoin);
    // handler skips same origin — call count unchanged from bus re-entry
    expect(listener.mock.calls.length).toBe(before);

    expect(bus.nodeId).toBeTruthy();
  });

  it('applyRemoteCollabEvent merges lock state', () => {
    applyRemoteCollabEvent('p1', {
      type: 'lock.acquired',
      projectId: 'p1',
      lock: {
        path: 'index.html',
        sessionId: 'r1',
        displayName: 'R',
        acquiredAt: 't',
      },
      ts: 't',
    });
    expect(listProjectLocks('p1')[0]?.path).toBe('index.html');
    applyRemoteCollabEvent('p1', {
      type: 'lock.released',
      projectId: 'p1',
      path: 'index.html',
      sessionId: 'r1',
      ts: 't',
    });
    expect(listProjectLocks('p1')).toHaveLength(0);
  });
});
