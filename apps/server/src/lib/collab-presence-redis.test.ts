import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPresenceRegistry,
  resolvePresenceRegistryMode,
  resetPresenceRegistryForTests,
  setPresenceRegistryForTests,
  type PresenceRegistry,
} from './collab-presence-redis.js';
import {
  clearMembershipStore,
  hydrateMembershipFromRegistry,
  listMembershipPeers,
  membershipCount,
} from './collab-presence-store.js';

describe('collab-presence-redis', () => {
  afterEach(() => {
    resetPresenceRegistryForTests();
    clearMembershipStore();
  });

  it('resolvePresenceRegistryMode defaults and parses env', () => {
    expect(resolvePresenceRegistryMode({})).toBe('auto');
    expect(resolvePresenceRegistryMode({ NEOS_COLLAB_PRESENCE: 'off' })).toBe('off');
    expect(resolvePresenceRegistryMode({ NEOS_COLLAB_PRESENCE: 'memory' })).toBe('memory');
    expect(resolvePresenceRegistryMode({ NEOS_COLLAB_PRESENCE: 'redis' })).toBe('redis');
    expect(resolvePresenceRegistryMode({ NEOS_COLLAB_PRESENCE: 'AUTO' })).toBe('auto');
  });

  it('auto without redis bus is memory registry', () => {
    const r = createPresenceRegistry({ NEOS_COLLAB_BUS: 'memory' });
    expect(r.kind).toBe('memory');
    expect(r.status().ready).toBe(true);
  });

  it('redis mode without URL is redis-stub', () => {
    const r = createPresenceRegistry({
      NEOS_COLLAB_PRESENCE: 'redis',
      NEOS_COLLAB_BUS: 'redis',
    });
    expect(r.kind).toBe('redis-stub');
  });

  it('hydrateMembershipFromRegistry merges remote peers from registry', async () => {
    const list = vi.fn(async () => [
      {
        sessionId: 'from-redis',
        displayName: 'RedisPeer',
        joinedAt: '2026-01-01T00:00:00.000Z',
        colorHint: 33,
        lastSeen: new Date().toISOString(),
      },
    ]);
    const mock: PresenceRegistry = {
      kind: 'redis',
      put: vi.fn(),
      del: vi.fn(),
      touch: vi.fn(),
      list,
      status: () => ({ kind: 'redis', ready: true }),
      close: vi.fn(),
    };
    setPresenceRegistryForTests(mock);
    const n = await hydrateMembershipFromRegistry('proj-1');
    expect(n).toBe(1);
    expect(list).toHaveBeenCalledWith('proj-1');
    expect(membershipCount('proj-1')).toBe(1);
    expect(listMembershipPeers('proj-1')[0]!.displayName).toBe('RedisPeer');

    // second hydrate is idempotent count of new
    const n2 = await hydrateMembershipFromRegistry('proj-1');
    expect(n2).toBe(0);
  });

  it('upsert dual-writes to registry', async () => {
    const put = vi.fn();
    const del = vi.fn();
    const touch = vi.fn();
    setPresenceRegistryForTests({
      kind: 'redis',
      put,
      del,
      touch,
      list: async () => [],
      status: () => ({ kind: 'redis', ready: true }),
      close: () => {},
    });
    const { upsertMembership, removeMembership, touchMembership } = await import(
      './collab-presence-store.js'
    );
    upsertMembership(
      'p1',
      { sessionId: 's1', displayName: 'A', joinedAt: 't', colorHint: 1 },
      { remote: false },
    );
    expect(put).toHaveBeenCalled();
    touchMembership('p1', 's1');
    expect(touch).toHaveBeenCalled();
    removeMembership('p1', 's1');
    expect(del).toHaveBeenCalled();
  });
});
