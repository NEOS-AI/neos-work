import { describe, expect, it } from 'vitest';
import { formatListCount } from './list-count.js';

describe('formatListCount', () => {
  it('formats visible over total', () => {
    expect(formatListCount(3, 10)).toBe('3/10');
    expect(formatListCount(0, 0)).toBe('0/0');
  });

  it('floors and clamps non-finite to 0', () => {
    expect(formatListCount(2.9, 5.1)).toBe('2/5');
    expect(formatListCount(Number.NaN, 4)).toBe('0/4');
    expect(formatListCount(-1, 3)).toBe('0/3');
  });
});
