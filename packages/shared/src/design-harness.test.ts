import { describe, expect, it } from 'vitest';
import { DESIGN_HARNESS_WRAP_MAX } from './design-harness.js';
import { DESIGN_HARNESS_WRAP_MAX as fromBarrel } from './index.js';

describe('DESIGN_HARNESS_WRAP_MAX', () => {
  it('DESIGN_HARNESS_WRAP_MAX is 64_000', () => {
    expect(DESIGN_HARNESS_WRAP_MAX).toBe(64_000);
    expect(fromBarrel).toBe(64_000);
  });
});
