import { describe, expect, it } from 'vitest';
import {
  resolveMaxResults,
  resolveMessageText,
  resolveSearchQuery,
} from './message-text.js';

describe('resolveMessageText', () => {
  it('prefers textTemplate over content/text and interpolates placeholders', () => {
    expect(
      resolveMessageText(
        {
          textTemplate: 'Hello {{name}} — {{score}}',
          content: 'ignored',
          text: 'also-ignored',
        },
        { name: 'Ada', score: 42 },
      ),
    ).toBe('Hello Ada — 42');
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(
      resolveMessageText({ textTemplate: '{{x}} and {{x}}' }, { x: 'A' }),
    ).toBe('A and A');
  });

  it('falls back to content then text config keys', () => {
    expect(resolveMessageText({ content: 'from content' }, {})).toBe('from content');
    expect(resolveMessageText({ text: 'from text' }, {})).toBe('from text');
  });

  it('treats whitespace-only templates as missing', () => {
    expect(resolveMessageText({ textTemplate: '   ' }, { text: 'upstream' })).toBe('upstream');
  });

  it('falls back to inputs.text then JSON of inputs', () => {
    expect(resolveMessageText({}, { text: 'upstream' })).toBe('upstream');
    expect(resolveMessageText({}, { a: 1 })).toBe('{"a":1}');
    expect(resolveMessageText(undefined, {})).toBe('');
  });

  it('JSON-stringifies non-string input values in templates', () => {
    expect(
      resolveMessageText({ textTemplate: 'obj={{data}}' }, { data: { ok: true } }),
    ).toBe('obj={"ok":true}');
  });
});

describe('resolveMaxResults', () => {
  it('defaults and clamps to 1–20', () => {
    expect(resolveMaxResults(undefined)).toBe(5);
    expect(resolveMaxResults({})).toBe(5);
    expect(resolveMaxResults({ maxResults: 10 })).toBe(10);
    expect(resolveMaxResults({ maxResults: 0 })).toBe(1);
    expect(resolveMaxResults({ maxResults: 99 })).toBe(20);
    expect(resolveMaxResults({ maxResults: 3.7 })).toBe(3);
    expect(resolveMaxResults({ maxResults: '8' })).toBe(8);
    expect(resolveMaxResults({ maxResults: 'nope' })).toBe(5);
    expect(resolveMaxResults({ maxResults: '' })).toBe(5);
    expect(resolveMaxResults({ maxResults: '  ' })).toBe(5);
    expect(resolveMaxResults({ maxResults: -3 })).toBe(1);
  });

  it('accepts a custom fallback', () => {
    expect(resolveMaxResults({}, 7)).toBe(7);
    expect(resolveMaxResults({ maxResults: Number.NaN }, 9)).toBe(9);
  });
});

describe('resolveSearchQuery', () => {
  it('prefers config.query then inputs', () => {
    expect(resolveSearchQuery({ query: ' cfg ' }, { query: 'in' })).toBe('cfg');
    expect(resolveSearchQuery({}, { query: 'q' })).toBe('q');
    expect(resolveSearchQuery({}, { text: 't' })).toBe('t');
    expect(resolveSearchQuery({}, {})).toBe('');
    expect(resolveSearchQuery(undefined, {})).toBe('');
  });

  it('stringifies non-string query/text inputs', () => {
    expect(resolveSearchQuery({}, { query: 123 })).toBe('123');
    expect(resolveSearchQuery({ query: '' }, { text: false })).toBe('false');
    expect(resolveSearchQuery({ query: '   ' }, { query: 'fallback' })).toBe('fallback');
  });
});
