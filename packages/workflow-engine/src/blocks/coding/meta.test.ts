import { beforeAll, describe, expect, it } from 'vitest';
import { listBlocks, resolveBlock, getNativeExecutor } from '../registry.js';
import { registerCodingBlocks } from './index.js';

describe('coding block metadata', () => {
  beforeAll(() => {
    registerCodingBlocks();
  });

  it('registers all five coding blocks with metadata', () => {
    const ids = ['code_eval', 'file_read', 'file_write', 'git_diff', 'test_runner'];
    for (const id of ids) {
      expect(getNativeExecutor(id)).toBeDefined();
      const meta = resolveBlock(id);
      expect(meta).toBeDefined();
      expect(meta?.domain).toBe('coding');
      expect(meta?.category).toBe('coding');
      expect(meta?.isBuiltIn).toBe(true);
      expect(meta?.implementationType).toBe('native');
      expect(meta?.paramDefs.length).toBeGreaterThan(0);
    }
  });

  it('lists coding domain blocks', () => {
    const coding = listBlocks('coding');
    expect(coding.some((b) => b.id === 'code_eval')).toBe(true);
    expect(coding.every((b) => b.domain === 'coding')).toBe(true);
  });
});
