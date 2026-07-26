import { describe, expect, it } from 'vitest';
import { scrubErrorMessage } from './base.js';

describe('scrubErrorMessage', () => {
  it('strips null bytes, collapses CR/LF, and trims', () => {
    expect(scrubErrorMessage(`  boom${'\n'}now${'\r\n'}x${'\0'}!  `)).toBe('boom now x!');
    expect(scrubErrorMessage('\0\n\r')).toBe('');
  });

  it('stringifies non-string inputs and treats nullish as empty', () => {
    expect(scrubErrorMessage(null)).toBe('');
    expect(scrubErrorMessage(undefined)).toBe('');
    expect(scrubErrorMessage(42)).toBe('42');
    expect(scrubErrorMessage({ code: 'E' })).toBe('[object Object]');
  });

  it('caps length at default 2000 and respects custom maxChars', () => {
    expect(scrubErrorMessage('a'.repeat(3_000)).length).toBe(2_000);
    expect(scrubErrorMessage('b'.repeat(500), 100).length).toBe(100);
    // Non-positive maxChars falls back to 2000
    expect(scrubErrorMessage('c'.repeat(3_000), 0).length).toBe(2_000);
    expect(scrubErrorMessage('d'.repeat(3_000), -5).length).toBe(2_000);
  });

  it('returns empty string only after scrub (whitespace/control only)', () => {
    expect(scrubErrorMessage('   \n\t  ')).toBe('');
  });
});
