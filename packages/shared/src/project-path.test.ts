import { describe, expect, it } from 'vitest';
import { normalizeProjectRelPath } from './project-path.js';

describe('normalizeProjectRelPath', () => {
  it('keeps normal relative paths', () => {
    expect(normalizeProjectRelPath('a/b.html')).toBe('a/b.html');
  });

  it('strips leading slashes', () => {
    expect(normalizeProjectRelPath('/abs')).toBe('abs');
  });

  it('normalizes backslashes and trims whitespace', () => {
    expect(normalizeProjectRelPath('  a\\b.html  ')).toBe('a/b.html');
  });

  it('rejects path traversal', () => {
    expect(normalizeProjectRelPath('../x')).toBe('');
  });

  it('rejects home-relative paths', () => {
    expect(normalizeProjectRelPath('~/x')).toBe('');
  });

  it('rejects Windows drive paths', () => {
    expect(normalizeProjectRelPath('C:/Windows')).toBe('');
  });

  it('rejects null and non-strings', () => {
    expect(normalizeProjectRelPath(null)).toBe('');
    expect(normalizeProjectRelPath(undefined)).toBe('');
    expect(normalizeProjectRelPath(42)).toBe('');
  });

  it('rejects control characters', () => {
    expect(normalizeProjectRelPath(`a${'\0'}b`)).toBe('');
    expect(normalizeProjectRelPath('a\rb')).toBe('');
    expect(normalizeProjectRelPath('a\nb')).toBe('');
  });

  it('rejects paths longer than 500 chars', () => {
    expect(normalizeProjectRelPath('x'.repeat(501))).toBe('');
    expect(normalizeProjectRelPath('x'.repeat(500))).toBe('x'.repeat(500));
  });
});
