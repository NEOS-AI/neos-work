import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCollabLockConflictResponse,
  assertCollabLockSuccessResponse,
  assertProjectFileWriteResponse,
  wireAssertEnabled,
} from './wire-assert.js';

describe('wireAssertEnabled', () => {
  it('on by default outside production', () => {
    expect(wireAssertEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(wireAssertEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(wireAssertEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('NEOS_ASSERT_WIRE overrides', () => {
    expect(wireAssertEnabled({ NODE_ENV: 'production', NEOS_ASSERT_WIRE: '1' })).toBe(true);
    expect(wireAssertEnabled({ NODE_ENV: 'test', NEOS_ASSERT_WIRE: '0' })).toBe(false);
  });
});

describe('assertProjectFileWriteResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs on invalid body when enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertProjectFileWriteResponse(
      { ok: true, data: { path: 'a', contentHash: 'x', bytes: 1, created: false } },
      { NODE_ENV: 'test' },
    );
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/wire-assert|hash/i);
  });

  it('silent when valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertProjectFileWriteResponse(
      {
        ok: true,
        data: { path: 'a.html', hash: 'deadbeef', bytes: 2, created: true },
      },
      { NODE_ENV: 'test' },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('no-op in production without NEOS_ASSERT_WIRE', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertProjectFileWriteResponse({ ok: true, data: {} }, { NODE_ENV: 'production' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws when NEOS_ASSERT_WIRE=throw', () => {
    expect(() =>
      assertProjectFileWriteResponse(
        { ok: true, data: { path: 'a', contentHash: 'x', bytes: 1, created: false } },
        { NEOS_ASSERT_WIRE: 'throw' },
      ),
    ).toThrow(/wire-assert/);
  });
});

describe('assertCollabLock*Response', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts conflict with holder', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertCollabLockConflictResponse(
      {
        ok: false,
        error: 'locked',
        data: { holder: { sessionId: 's1', displayName: 'A' } },
      },
      { NODE_ENV: 'test' },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts lock success', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertCollabLockSuccessResponse(
      {
        ok: true,
        data: {
          lock: {
            path: 'index.html',
            sessionId: 's1',
            displayName: 'A',
            acquiredAt: new Date().toISOString(),
          },
        },
      },
      { NODE_ENV: 'test' },
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('assert peers / selections / run summary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts peers and selections snapshots', async () => {
    const { assertCollabPeersSnapshotResponse, assertCollabSelectionsSnapshotResponse } =
      await import('./wire-assert.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertCollabPeersSnapshotResponse(
      {
        ok: true,
        data: {
          peers: [
            {
              sessionId: 's1',
              displayName: 'A',
              joinedAt: new Date().toISOString(),
              colorHint: 10,
            },
          ],
        },
      },
      { NODE_ENV: 'test' },
    );
    assertCollabSelectionsSnapshotResponse(
      {
        ok: true,
        data: {
          selections: [
            {
              sessionId: 's1',
              path: 'index.html',
              selector: '#hero',
              displayName: 'A',
              colorHint: 10,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
      { NODE_ENV: 'test' },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns on bad run summary', async () => {
    const { assertProjectRunSummary } = await import('./wire-assert.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assertProjectRunSummary({ status: 'running' }, { NODE_ENV: 'test' });
    expect(warn).toHaveBeenCalled();
  });
});
