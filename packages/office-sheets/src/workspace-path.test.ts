import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProtectedPath, safePath } from './workspace-path.js';

describe('workspace-path safePath', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neos-sheets-path-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects ../x with the same outside-workspace message as filesystem.ts', async () => {
    await writeFile(join(root, 'ok.univer.json'), '{}\n');
    expect(() => safePath(root, '../x')).toThrow('Path "../x" is outside the workspace');
  });

  it('rejects null bytes before trim', () => {
    expect(() => safePath(root, 'ok\0x')).toThrow(/control characters/i);
  });
});

describe('isProtectedPath', () => {
  it('flags .env and .git paths', () => {
    expect(isProtectedPath('.env')).toBe(true);
    expect(isProtectedPath('.env.local')).toBe(true);
    expect(isProtectedPath('.git/config')).toBe(true);
    expect(isProtectedPath('budget.univer.json')).toBe(false);
  });
});
