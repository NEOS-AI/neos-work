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
});
