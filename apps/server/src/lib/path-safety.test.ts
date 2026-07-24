import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWorkspacePath } from './path-safety.js';

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
});
