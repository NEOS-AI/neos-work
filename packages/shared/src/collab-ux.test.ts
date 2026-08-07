import { describe, expect, it } from 'vitest';
import {
  extractLockHolder,
  formatLockHolderMessage,
  formatRunLockFailureMessage,
  formatSharedEditFlags,
  isFileLockErrorMessage,
  parseCollabStatusData,
  shortSessionId,
} from './collab-ux.js';

describe('collab-ux (v0.11 M1)', () => {
  it('extracts and formats lock holders', () => {
    const h = extractLockHolder({
      holder: {
        sessionId: 'abcdef0123456789',
        displayName: 'Alice',
        path: 'index.html',
      },
    });
    expect(h).toEqual({
      sessionId: 'abcdef0123456789',
      displayName: 'Alice',
      path: 'index.html',
      acquiredAt: undefined,
    });
    expect(formatLockHolderMessage(h)).toBe('Locked by Alice (abcdef01)');
    expect(shortSessionId('short')).toBe('short');
    expect(extractLockHolder(null)).toBeNull();
    expect(formatLockHolderMessage(null)).toMatch(/locked by another session/i);
  });

  it('detects lock errors and formats run failures', () => {
    expect(isFileLockErrorMessage('File locked by Bob')).toBe(true);
    expect(isFileLockErrorMessage('HTTP 423')).toBe(true);
    expect(isFileLockErrorMessage('network down')).toBe(false);
    expect(formatRunLockFailureMessage('File locked by Bob')).toBe(
      'File locked by Bob',
    );
    expect(formatRunLockFailureMessage('something 423 else')).toMatch(
      /Agent write blocked by file lock/,
    );
    expect(formatRunLockFailureMessage('unrelated')).toBeNull();
  });

  it('parses collab status and formats shared-edit flags', () => {
    const st = parseCollabStatusData({
      bus: 'redis',
      nodeId: 'n1',
      ready: true,
      presence: { kind: 'redis', ready: true },
      locks: { kind: 'redis', ready: true, detail: null },
      sharedEdit: { hardEnforce: true, agentsHardEnforce: true },
    });
    expect(st?.sharedEdit?.agentsHardEnforce).toBe(true);
    expect(st?.locks?.kind).toBe('redis');
    expect(formatSharedEditFlags(st?.sharedEdit)).toBe(
      'hard-enforce on · agents on',
    );
    expect(formatSharedEditFlags({ hardEnforce: true, agentsHardEnforce: false })).toBe(
      'hard-enforce on · agents off',
    );
    expect(formatSharedEditFlags({ hardEnforce: false })).toBe('hard-enforce off');
    expect(parseCollabStatusData('nope')).toBeNull();
  });
});
