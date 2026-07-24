import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeHtml, safeError } from './errors.js';

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

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('access_denied')).toBe('access_denied');
  });

  it('escapes empty string and multi-entity payloads', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });
});
