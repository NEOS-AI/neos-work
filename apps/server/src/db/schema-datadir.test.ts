import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDbDir, resolveDbPath } from './schema.js';

const prev = process.env.NEOS_DATA_DIR;

afterEach(() => {
  if (prev === undefined) delete process.env.NEOS_DATA_DIR;
  else process.env.NEOS_DATA_DIR = prev;
});

describe('resolveDbDir / resolveDbPath', () => {
  it('defaults under home .neos-work', () => {
    delete process.env.NEOS_DATA_DIR;
    expect(resolveDbDir()).toBe(path.join(os.homedir(), '.neos-work'));
    expect(resolveDbPath()).toBe(path.join(os.homedir(), '.neos-work', 'data.db'));
  });

  it('uses NEOS_DATA_DIR when set', () => {
    process.env.NEOS_DATA_DIR = '/tmp/neos-data-test-dir';
    expect(resolveDbDir()).toBe(path.resolve('/tmp/neos-data-test-dir'));
    expect(resolveDbPath()).toBe(path.resolve('/tmp/neos-data-test-dir', 'data.db'));
  });

  it('ignores control-char NEOS_DATA_DIR', () => {
    process.env.NEOS_DATA_DIR = '/tmp/bad\ndir';
    expect(resolveDbDir()).toBe(path.join(os.homedir(), '.neos-work'));
  });
});
