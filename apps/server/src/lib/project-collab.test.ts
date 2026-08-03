import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireFileLock,
  clearProjectPresence,
  colorHintFromSessionId,
  getFileLock,
  isSharedEditHardEnforce,
  joinProjectPresence,
  listProjectLocks,
  listProjectPeers,
  listProjectSelections,
  normalizeLockPath,
  PRESENCE_IDLE_MS,
  projectPresenceCount,
  releaseFileLock,
  sanitizeDisplayName,
  sanitizeSelector,
  setSessionSelection,
  sweepIdlePresence,
  touchProjectPresence,
} from './project-collab.js';
import { resetCollabBusForTests } from './collab-bus.js';

describe('project-collab presence', () => {
  afterEach(() => {
    clearProjectPresence();
    resetCollabBusForTests();
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

  it('normalizeLockPath rejects traversal', () => {
    expect(normalizeLockPath('../x')).toBe('');
    expect(normalizeLockPath('a/b.html')).toBe('a/b.html');
    expect(normalizeLockPath('/abs')).toBe('abs');
  });

  it('file locks: acquire conflict release and clear on leave', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ja = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: a })!;
    const jb = joinProjectPresence({ projectId: 'p1', displayName: 'B', listener: b })!;

    const ok = acquireFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error('expected lock');
    expect(listProjectLocks('p1')).toHaveLength(1);
    expect(getFileLock('p1', 'index.html')?.sessionId).toBe(ja.sessionId);

    const conflict = acquireFileLock({
      projectId: 'p1',
      sessionId: jb.sessionId,
      path: 'index.html',
    });
    expect(conflict.ok).toBe(false);

    // sync includes locks for new joiners
    const jc = joinProjectPresence({ projectId: 'p1', displayName: 'C', listener: vi.fn() })!;
    expect(jc.sync.type).toBe('presence.sync');
    if (jc.sync.type === 'presence.sync') {
      expect(jc.sync.locks.some((l) => l.path === 'index.html')).toBe(true);
    }
    jc.unsub();

    releaseFileLock({ projectId: 'p1', sessionId: ja.sessionId, path: 'index.html' });
    expect(getFileLock('p1', 'index.html')).toBeNull();

    acquireFileLock({ projectId: 'p1', sessionId: ja.sessionId, path: 'a.html' });
    ja.unsub(); // should release locks
    expect(listProjectLocks('p1')).toHaveLength(0);
    jb.unsub();
  });

  it('isSharedEditHardEnforce reads env', () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    process.env.NEOS_SHARED_EDIT = '1';
    expect(isSharedEditHardEnforce()).toBe(true);
    process.env.NEOS_SHARED_EDIT = '0';
    expect(isSharedEditHardEnforce()).toBe(false);
    if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
    else process.env.NEOS_SHARED_EDIT = prev;
  });

  it('sanitizeSelector bounds and strips controls', () => {
    expect(sanitizeSelector('  #hero > h1  ')).toBe('#hero > h1');
    expect(sanitizeSelector('a\nb')).toBeNull();
    expect(sanitizeSelector('x'.repeat(500))!.length).toBe(400);
    expect(sanitizeSelector(null)).toBeNull();
    expect(sanitizeSelector('')).toBeNull();
  });

  it('selection.changed broadcasts path+selector and clears on leave', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ja = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: a })!;
    const jb = joinProjectPresence({ projectId: 'p1', displayName: 'B', listener: b })!;

    const set = setSessionSelection({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
      selector: '#hero',
      layerId: 'neos-1',
    });
    expect(set.ok).toBe(true);
    if (!set.ok) throw new Error('expected selection');
    expect(set.selection.path).toBe('index.html');
    expect(set.selection.selector).toBe('#hero');
    expect(listProjectSelections('p1')).toHaveLength(1);

    expect(b).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'selection.changed',
        selection: expect.objectContaining({
          sessionId: ja.sessionId,
          path: 'index.html',
          selector: '#hero',
          displayName: 'A',
        }),
      }),
    );

    // sync includes selections for new joiners
    const jc = joinProjectPresence({ projectId: 'p1', displayName: 'C', listener: vi.fn() })!;
    expect(jc.sync.type).toBe('presence.sync');
    if (jc.sync.type === 'presence.sync') {
      expect(jc.sync.selections.some((s) => s.path === 'index.html')).toBe(true);
    }
    jc.unsub();

    // clear selection
    const cleared = setSessionSelection({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: null,
      selector: null,
    });
    expect(cleared.ok).toBe(true);
    expect(listProjectSelections('p1')).toHaveLength(0);

    // re-set then leave should drop without leaving stale selection
    setSessionSelection({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'about.html',
      selector: 'main',
    });
    expect(listProjectSelections('p1')).toHaveLength(1);
    ja.unsub();
    expect(listProjectSelections('p1')).toHaveLength(0);
    jb.unsub();
  });

  it('setSessionSelection rejects bad path and missing session', () => {
    const j = joinProjectPresence({ projectId: 'p1', displayName: 'A', listener: () => {} })!;
    expect(
      setSessionSelection({
        projectId: 'p1',
        sessionId: j.sessionId,
        path: '../secret',
      }).ok,
    ).toBe(false);
    expect(
      setSessionSelection({
        projectId: 'p1',
        sessionId: 'missing',
        path: 'index.html',
      }).ok,
    ).toBe(false);
    j.unsub();
  });
});