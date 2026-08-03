import { describe, expect, it } from 'vitest';
import {
  isActiveRunStatus,
  isTerminalRunStatus,
  normalizeRunStatus,
} from './project.js';

describe('run status helpers', () => {
  it('isTerminalRunStatus covers canonical + aliases', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('canceled')).toBe(true);
    expect(isTerminalRunStatus('cancelled')).toBe(true);
    expect(isTerminalRunStatus('error')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('queued')).toBe(false);
    expect(isTerminalRunStatus(null)).toBe(false);
    expect(isTerminalRunStatus('')).toBe(false);
  });

  it('isActiveRunStatus is inverse of terminal for known states', () => {
    expect(isActiveRunStatus('running')).toBe(true);
    expect(isActiveRunStatus('queued')).toBe(true);
    expect(isActiveRunStatus('succeeded')).toBe(false);
    expect(isActiveRunStatus('canceled')).toBe(false);
  });

  it('normalizeRunStatus maps aliases', () => {
    expect(normalizeRunStatus('cancelled')).toBe('canceled');
    expect(normalizeRunStatus('ERROR')).toBe('failed');
    expect(normalizeRunStatus('running')).toBe('running');
    expect(normalizeRunStatus(null)).toBe('queued');
  });
});
