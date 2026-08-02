import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearProjectPresence,
  joinProjectPresence,
  projectPresenceCount,
  sanitizeDisplayName,
} from './project-collab.js';

describe('project-collab presence', () => {
  afterEach(() => {
    clearProjectPresence();
  });

  it('sanitizeDisplayName strips controls and bounds length', () => {
    expect(sanitizeDisplayName('  Alice  ')).toBe('Alice');
    expect(sanitizeDisplayName('a\nb')).toBe('Anonymous');
    expect(sanitizeDisplayName('<script>')).toBe('script');
    expect(sanitizeDisplayName('x'.repeat(100)).length).toBe(48);
    expect(sanitizeDisplayName(null)).toBe('Anonymous');
  });

  it('join delivers sync to self and join to peers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: a });
    expect(first).not.toBeNull();
    expect(first!.sync.type).toBe('presence.sync');
    expect(first!.sync.peers).toEqual([]);
    expect(projectPresenceCount('p1')).toBe(1);

    const second = joinProjectPresence({ projectId: 'p1', displayName: 'B', listener: b });
    expect(second).not.toBeNull();
    expect(second!.sync.peers).toHaveLength(1);
    expect(second!.sync.peers[0]!.displayName).toBe('A');
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'presence.join',
        peer: expect.objectContaining({ displayName: 'B' }),
      }),
    );

    second!.unsub();
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'presence.leave',
        sessionId: second!.sessionId,
      }),
    );
    expect(projectPresenceCount('p1')).toBe(1);
    first!.unsub();
    expect(projectPresenceCount('p1')).toBe(0);
  });

  it('rejects invalid project ids', () => {
    expect(joinProjectPresence({ projectId: 'bad\nid', listener: () => {} })).toBeNull();
    expect(joinProjectPresence({ projectId: '   ', listener: () => {} })).toBeNull();
  });

  it('isolates projects', () => {
    const a = vi.fn();
    const b = vi.fn();
    joinProjectPresence({ projectId: 'p-a', listener: a });
    joinProjectPresence({ projectId: 'p-b', displayName: 'X', listener: b });
    expect(a).not.toHaveBeenCalled();
    expect(projectPresenceCount('p-a')).toBe(1);
    expect(projectPresenceCount('p-b')).toBe(1);
  });
});
