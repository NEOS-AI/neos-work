import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_ID_MAX_CHARS, safeRouteId, validateWorkspacePath } from './path-safety.js';

describe('safeRouteId', () => {
  it('trims and accepts normal ids', () => {
    expect(safeRouteId('  abc-123  ')).toBe('abc-123');
  });

  it('rejects blank, control-char, and overlong ids', () => {
    expect(safeRouteId('')).toBe('');
    expect(safeRouteId('   ')).toBe('');
    expect(safeRouteId('a\nb')).toBe('');
    expect(safeRouteId('a\0b')).toBe('');
    // Leading/trailing control chars must not be silently stripped by trim
    expect(safeRouteId('\nevil')).toBe('');
    expect(safeRouteId('evil\r')).toBe('');
    expect(safeRouteId('x'.repeat(ROUTE_ID_MAX_CHARS + 1))).toBe('');
    expect(safeRouteId(null)).toBe('');
    expect(safeRouteId(42)).toBe('');
  });

  it('respects custom max length', () => {
    expect(safeRouteId('abcdef', 5)).toBe('');
    expect(safeRouteId('abcde', 5)).toBe('abcde');
  });
});

describe('validateWorkspacePath', () => {
  it('accepts home and paths under home', () => {
    const home = homedir();
    expect(validateWorkspacePath(home)).toBe(true);
    expect(validateWorkspacePath(path.join(home, 'projects', 'neos'))).toBe(true);
  });

  it('rejects empty and outside home', () => {
    expect(validateWorkspacePath('')).toBe(false);
    expect(validateWorkspacePath('   ')).toBe(false);
    expect(validateWorkspacePath('/tmp/outside')).toBe(false);
    expect(validateWorkspacePath('/etc/passwd')).toBe(false);
  });

  it('trims paths before validation', () => {
    const home = homedir();
    expect(validateWorkspacePath(`  ${home}  `)).toBe(true);
    expect(validateWorkspacePath(`  ${path.join(home, 'projects')}  `)).toBe(true);
  });
  it('rejects null bytes and control characters', () => {
    const home = homedir();
    expect(validateWorkspacePath(home + '\0evil')).toBe(false);
    expect(validateWorkspacePath(home + '\n/evil')).toBe(false);
    expect(validateWorkspacePath(home + '\r/evil')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(validateWorkspacePath(null as unknown as string)).toBe(false);
    expect(validateWorkspacePath(undefined as unknown as string)).toBe(false);
    expect(validateWorkspacePath(42 as unknown as string)).toBe(false);
  });

  it('rejects overlong paths', () => {
    const home = homedir();
    expect(validateWorkspacePath(home + '/x'.repeat(5_000))).toBe(false);
  });
});
