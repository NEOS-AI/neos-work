import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeHtml, publicErrorMessage, safeError } from './errors.js';

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

  it('trims safeError context labels', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeError('x', '  ctx  ');
    expect(String(spy.mock.calls[0]?.[0])).toContain('ctx');
  });

  it('rejects control-char contexts and scrubs control chars from log messages', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeError(new Error('line1\nline2\rsecret'), 'bad\nctx');
    // Control-char context falls back to "app"
    expect(String(spy.mock.calls[0]?.[0])).toContain('[app]');
    expect(String(spy.mock.calls[0]?.[0])).not.toContain('bad');
    // Newlines in error message are replaced for log injection defense
    const logged = String(spy.mock.calls[0]?.[1] ?? '');
    expect(logged).not.toMatch(/[\r\n]/);
    expect(logged).toContain('line1');
    expect(logged).toContain('line2');
  });

  it('caps overlong safeError messages', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeError(new Error('e'.repeat(10_000)), 'c'.repeat(300));
    const logged = String(spy.mock.calls[0]?.[1] ?? '');
    expect(logged.length).toBeLessThanOrEqual(4_000);
  });
});

describe('publicErrorMessage', () => {
  it('scrubs control chars and falls back when empty', () => {
    expect(publicErrorMessage(new Error(`disk${'\n'}full${'\0'}!`), 'fallback')).toBe(
      'disk full!',
    );
    expect(publicErrorMessage(new Error('\0\n'), 'fallback')).toBe('fallback');
    expect(publicErrorMessage('plain', 'fallback')).toBe('plain');
    expect(publicErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('caps overlong public error messages', () => {
    const msg = publicErrorMessage(new Error('e'.repeat(10_000)), 'fb', 100);
    expect(msg.length).toBeLessThanOrEqual(100);
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

  it('coerces non-string values for escapeHtml', () => {
    expect(escapeHtml(null as never)).toBe('');
    expect(escapeHtml(undefined as never)).toBe('');
    expect(escapeHtml(42 as never)).toBe('42');
  });

  it('caps overlong escapeHtml input', () => {
    const escaped = escapeHtml('x'.repeat(60_000));
    expect(escaped.length).toBeLessThanOrEqual(50_000);
  });

  it('strips null bytes before HTML escaping', () => {
    expect(escapeHtml(`hi${'\0'}<b>`)).toBe('hi&lt;b&gt;');
    expect(escapeHtml(`a${'\0'}b`)).toBe('ab');
  });
});
