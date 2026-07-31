import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearProjectFileEventListeners,
  projectFileEventListenerCount,
  publishProjectFileEvent,
  subscribeProjectFileEvents,
} from './project-file-events.js';

describe('project-file-events', () => {
  afterEach(() => {
    clearProjectFileEventListeners();
  });

  it('delivers events to matching project subscribers only', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeProjectFileEvents('proj-a', a);
    subscribeProjectFileEvents('proj-b', b);

    publishProjectFileEvent({
      type: 'file.changed',
      projectId: 'proj-a',
      path: 'index.html',
      source: 'user',
      hash: 'abc',
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]![0]).toMatchObject({
      type: 'file.changed',
      projectId: 'proj-a',
      path: 'index.html',
      source: 'user',
      hash: 'abc',
    });
    expect(typeof a.mock.calls[0]![0].ts).toBe('string');
    expect(b).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const unsub = subscribeProjectFileEvents('p1', fn);
    unsub();
    publishProjectFileEvent({ type: 'file.deleted', projectId: 'p1', path: 'x.txt' });
    expect(fn).not.toHaveBeenCalled();
    expect(projectFileEventListenerCount('p1')).toBe(0);
  });

  it('rejects invalid projectId / path', () => {
    const fn = vi.fn();
    subscribeProjectFileEvents('ok', fn);
    publishProjectFileEvent({ type: 'file.changed', projectId: 'ab\0c', path: 'a.html' });
    publishProjectFileEvent({ type: 'file.changed', projectId: 'ok', path: '../escape' });
    publishProjectFileEvent({ type: 'file.changed', projectId: 'ok', path: 'a\nb.html' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('listener throw does not break other listeners', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    subscribeProjectFileEvents('p', bad);
    subscribeProjectFileEvents('p', good);
    publishProjectFileEvent({ type: 'file.created', projectId: 'p', path: 'n.html' });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('caps listeners per project and ignores invalid subscribe ids', () => {
    // invalid id → no-op unsubscribe
    const unsubBad = subscribeProjectFileEvents('bad\nid', () => {});
    unsubBad();
    const unsubBlank = subscribeProjectFileEvents('   ', () => {});
    unsubBlank();
    const unsubLong = subscribeProjectFileEvents('x'.repeat(200), () => {});
    unsubLong();

    const kept = vi.fn();
    // Exceed MAX_LISTENERS_PER_PROJECT (64) — oldest dropped
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 70; i++) {
      unsubs.push(subscribeProjectFileEvents('cap-proj', i === 69 ? kept : () => {}));
    }
    expect(projectFileEventListenerCount('cap-proj')).toBeLessThanOrEqual(64);

    publishProjectFileEvent({
      type: 'file.changed',
      projectId: 'cap-proj',
      path: 'a.html',
    });
    expect(kept).toHaveBeenCalled();

    // unsubscribe after clear path
    for (const u of unsubs) u();
    expect(projectFileEventListenerCount('cap-proj')).toBe(0);

    // overlong / traversal path rejected
    const fn = vi.fn();
    subscribeProjectFileEvents('cap-proj', fn);
    publishProjectFileEvent({
      type: 'file.changed',
      projectId: 'cap-proj',
      path: 'p'.repeat(1_001),
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
