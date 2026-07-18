import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeError } from './errors.js';

describe('safeError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns generic message and logs Error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = safeError(new Error('db connection failed at /secret'), 'workflow.run');
    expect(msg).toBe('An internal error occurred');
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('workflow.run');
  });

  it('handles non-Error values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safeError('boom', 'ctx')).toBe('An internal error occurred');
    expect(spy).toHaveBeenCalled();
  });
});
