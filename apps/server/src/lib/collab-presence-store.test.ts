import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMembershipStore,
  listMembershipPeers,
  membershipCount,
  PRESENCE_REMOTE_IDLE_MS,
  removeMembership,
  sweepMembershipIdle,
  touchMembership,
  upsertMembership,
} from './collab-presence-store.js';

describe('collab-presence-store', () => {
  afterEach(() => {
    clearMembershipStore();
  });

  it('upserts local and remote peers and lists them', () => {
    upsertMembership(
      'p1',
      {
        sessionId: 'local1',
        displayName: 'A',
        joinedAt: 't0',
        colorHint: 10,
      },
      { remote: false },
    );
    upsertMembership(
      'p1',
      {
        sessionId: 'remote1',
        displayName: 'B',
        joinedAt: 't1',
        colorHint: 20,
      },
      { remote: true },
    );
    expect(membershipCount('p1')).toBe(2);
    const peers = listMembershipPeers('p1', 'local1');
    expect(peers).toHaveLength(1);
    expect(peers[0]!.sessionId).toBe('remote1');
  });

  it('local ownership wins over remote upsert', () => {
    upsertMembership(
      'p1',
      { sessionId: 's1', displayName: 'Local', joinedAt: 't', colorHint: 1 },
      { remote: false },
    );
    upsertMembership(
      'p1',
      { sessionId: 's1', displayName: 'Hijack', joinedAt: 't', colorHint: 2 },
      { remote: true },
    );
    const all = listMembershipPeers('p1');
    expect(all).toHaveLength(1);
    expect(all[0]!.displayName).toBe('Local');
  });

  it('touch refreshes lastSeen', () => {
    upsertMembership(
      'p1',
      { sessionId: 's1', displayName: 'A', joinedAt: 't', colorHint: 0 },
      { remote: true, lastSeenMs: Date.now() - 10_000 },
    );
    expect(touchMembership('p1', 's1')).toBe(true);
    expect(touchMembership('p1', 'missing')).toBe(false);
  });

  it('sweep drops stale remote members', () => {
    upsertMembership(
      'p1',
      { sessionId: 'old', displayName: 'Old', joinedAt: 't', colorHint: 0 },
      { remote: true, lastSeenMs: Date.now() - PRESENCE_REMOTE_IDLE_MS - 1 },
    );
    upsertMembership(
      'p1',
      { sessionId: 'fresh', displayName: 'Fresh', joinedAt: 't', colorHint: 1 },
      { remote: true, lastSeenMs: Date.now() },
    );
    const { remoteRemoved } = sweepMembershipIdle('p1');
    expect(remoteRemoved.map((r) => r.sessionId)).toEqual(['old']);
    expect(listMembershipPeers('p1').map((p) => p.sessionId)).toEqual(['fresh']);
    removeMembership('p1', 'fresh');
    expect(membershipCount('p1')).toBe(0);
  });
});
