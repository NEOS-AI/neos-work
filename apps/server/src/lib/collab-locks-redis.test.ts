import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLockRegistry,
  resolveLockRegistryMode,
  resetLockRegistryForTests,
  setLockRegistryForTests,
  type LockRegistry,
} from './collab-locks-redis.js';
import {
  clearProjectPresence,
  getFileLock,
  hydrateLocksFromRegistry,
  joinProjectPresence,
  listProjectLocks,
  acquireFileLock,
  releaseFileLock,
} from './project-collab.js';
import { putLocalLock, getStoredLock } from './collab-lock-store.js';

describe('collab-locks-redis', () => {
  afterEach(() => {
    resetLockRegistryForTests();
    clearProjectPresence();
  });

  it('resolveLockRegistryMode defaults and parses env', () => {
    expect(resolveLockRegistryMode({})).toBe('auto');
    expect(resolveLockRegistryMode({ NEOS_COLLAB_LOCKS: 'off' })).toBe('off');
    expect(resolveLockRegistryMode({ NEOS_COLLAB_LOCKS: 'memory' })).toBe('memory');
    expect(resolveLockRegistryMode({ NEOS_COLLAB_LOCKS: 'redis' })).toBe('redis');
    expect(resolveLockRegistryMode({ NEOS_COLLAB_LOCKS: 'AUTO' })).toBe('auto');
  });

  it('auto without redis bus is memory registry', () => {
    const r = createLockRegistry({ NEOS_COLLAB_BUS: 'memory' });
    expect(r.kind).toBe('memory');
    expect(r.status().ready).toBe(true);
  });

  it('redis mode without URL is redis-stub', () => {
    const r = createLockRegistry({
      NEOS_COLLAB_LOCKS: 'redis',
      NEOS_COLLAB_BUS: 'redis',
    });
    expect(r.kind).toBe('redis-stub');
    expect(r.status().ready).toBe(true);
  });

  it('hydrateLocksFromRegistry fill-missing only; does not overwrite local', async () => {
    await putLocalLock('proj-1', {
      path: 'index.html',
      sessionId: 'local-holder',
      displayName: 'Local',
      acquiredAt: '2026-01-01T00:00:00.000Z',
    });
    const list = vi.fn(async () => [
      {
        path: 'index.html',
        sessionId: 'from-redis',
        displayName: 'RedisHolder',
        acquiredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        path: 'other.html',
        sessionId: 'from-redis-2',
        displayName: 'Redis2',
        acquiredAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    setLockRegistryForTests({
      kind: 'redis',
      put: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
      touch: vi.fn(async () => {}),
      list,
      status: () => ({ kind: 'redis', ready: true }),
      close: vi.fn(async () => {}),
    });
    const n = await hydrateLocksFromRegistry('proj-1');
    expect(n).toBe(1); // only other.html
    expect(getFileLock('proj-1', 'index.html')?.sessionId).toBe('local-holder');
    expect(getFileLock('proj-1', 'other.html')?.sessionId).toBe('from-redis-2');

    const n2 = await hydrateLocksFromRegistry('proj-1');
    expect(n2).toBe(0);
  });

  it('hydrate does not resurrect path under release tombstone', async () => {
    const ja = joinProjectPresence({
      projectId: 'p1',
      displayName: 'A',
      listener: vi.fn(),
    })!;
    setLockRegistryForTests({
      kind: 'redis',
      put: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
      touch: vi.fn(async () => {}),
      list: async () => [
        {
          path: 'index.html',
          sessionId: ja.sessionId,
          displayName: 'A',
          acquiredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      status: () => ({ kind: 'redis', ready: true }),
      close: async () => {},
    });
    await acquireFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    await releaseFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(getStoredLock('p1', 'index.html')).toBeNull();
    const n = await hydrateLocksFromRegistry('p1');
    expect(n).toBe(0);
    expect(getFileLock('p1', 'index.html')).toBeNull();
    ja.unsub();
  });

  it('acquire dual-writes put; release dual-writes del', async () => {
    const put = vi.fn(async () => {});
    const del = vi.fn(async () => {});
    const touch = vi.fn(async () => {});
    setLockRegistryForTests({
      kind: 'redis',
      put,
      del,
      touch,
      list: async () => [],
      status: () => ({ kind: 'redis', ready: true }),
      close: async () => {},
    });

    const ja = joinProjectPresence({
      projectId: 'p1',
      displayName: 'A',
      listener: vi.fn(),
    })!;
    const ok = await acquireFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(ok.ok).toBe(true);
    expect(put).toHaveBeenCalled();
    const putArg = put.mock.calls[0]![1] as { path: string; sessionId: string };
    expect(putArg.path).toBe('index.html');
    expect(putArg.sessionId).toBe(ja.sessionId);

    await acquireFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(touch).toHaveBeenCalled();

    await releaseFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(del).toHaveBeenCalledWith('p1', 'index.html');
    ja.unsub();
  });

  it('hydrate then acquire sees remote holder as conflict', async () => {
    setLockRegistryForTests({
      kind: 'redis',
      put: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
      touch: vi.fn(async () => {}),
      list: async () => [
        {
          path: 'index.html',
          sessionId: 'remote-holder',
          displayName: 'Remote',
          acquiredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      status: () => ({ kind: 'redis', ready: true }),
      close: async () => {},
    });
    await hydrateLocksFromRegistry('p1');
    const ja = joinProjectPresence({
      projectId: 'p1',
      displayName: 'Local',
      listener: vi.fn(),
    })!;
    const conflict = await acquireFileLock({
      projectId: 'p1',
      sessionId: ja.sessionId,
      path: 'index.html',
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error('expected conflict');
    expect(conflict.holder?.sessionId).toBe('remote-holder');
    expect(listProjectLocks('p1')).toHaveLength(1);
    ja.unsub();
  });
});
