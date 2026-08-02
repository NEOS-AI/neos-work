import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearProjectPresence,
  colorHintFromSessionId,
  joinProjectPresence,
  listProjectPeers,
  PRESENCE_IDLE_MS,
  projectPresenceCount,
  sanitizeDisplayName,
  sweepIdlePresence,
  touchProjectPresence,
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

  it('colorHintFromSessionId is stable 0–359', () => {
    const a = colorHintFromSessionId('abc');
    const b = colorHintFromSessionId('abc');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });

  it('join delivers sync to self and join to peers with colorHint', () => {
    const a = vi.fn();
    const b = vi.fn();
    const first = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: a });
    expect(first).not.toBeNull();
    expect(first!.sync.type).toBe('presence.sync');
    if (first!.sync.type !== 'presence.sync') throw new Error('expected sync');
    expect(first!.sync.peers).toEqual([]);
    expect(first!.sync.self.colorHint).toBeGreaterThanOrEqual(0);
    expect(projectPresenceCount('p1')).toBe(1);

    const second = joinProjectPresence({ projectId: 'p1', displayName: 'B', listener: b });
    expect(second).not.toBeNull();
    if (second!.sync.type !== 'presence.sync') throw new Error('expected sync');
    expect(second!.sync.peers).toHaveLength(1);
    expect(second!.sync.peers[0]!.displayName).toBe('A');
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'presence.join',
        peer: expect.objectContaining({ displayName: 'B', colorHint: expect.any(Number) }),
      }),
    );

    second!.unsub();
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'presence.leave',
        sessionId: second!.sessionId,
        reason: 'leave',
      }),
    );
    expect(projectPresenceCount('p1')).toBe(1);
    first!.unsub();
    expect(projectPresenceCount('p1')).toBe(0);
  });

  it('touch + idle sweep removes stale sessions', () => {
    const a = vi.fn();
    const j = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: a });
    expect(j).not.toBeNull();
    expect(touchProjectPresence('p1', j!.sessionId)).toBe(true);
    expect(touchProjectPresence('p1', 'missing')).toBe(false);

    // Force idle by rewinding lastSeen via internal touch then sweep with fake time
    // Simulate idle: call touch then manually sweep after mutating via double-join trick
    // Use sweep with sessions that haven't been touched — age by re-joining after patch:
    const roomPeer = listProjectPeers('p1')[0];
    expect(roomPeer?.displayName).toBe('A');

    // Access lastSeen by not touching and running sweep with reduced threshold isn't exported.
    // Instead: create session, then call sweepIdlePresence after waiting isn't practical.
    // Directly test force path: touch returns false for bad ids; sweep on empty is 0.
    expect(sweepIdlePresence('p1')).toBe(0);

    // Age session by monkey-patching through repeated joins not needed —
    // use Date.now mock
    const realNow = Date.now;
    try {
      const base = realNow();
      vi.spyOn(Date, 'now').mockImplementation(() => base + PRESENCE_IDLE_MS + 1);
      const n = sweepIdlePresence('p1');
      expect(n).toBe(1);
      expect(projectPresenceCount('p1')).toBe(0);
      expect(a).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'presence.leave', reason: 'idle' }),
      );
    } finally {
      vi.restoreAllMocks();
    }
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
