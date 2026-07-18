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
    expect(validateWorkspacePath('/tmp/outside')).toBe(false);
    expect(validateWorkspacePath('/etc/passwd')).toBe(false);
  });
});
