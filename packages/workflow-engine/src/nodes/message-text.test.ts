import { describe, expect, it } from 'vitest';
import {
  DISCORD_CONTENT_MAX_LENGTH,
  resolveMaxResults,
  resolveMessageText,
  resolveSearchQuery,
  SLACK_CONTENT_MAX_LENGTH,
} from './message-text.js';

describe('message content limits', () => {
  it('exports Discord/Slack hard limits aligned with desktop validation', () => {
    expect(DISCORD_CONTENT_MAX_LENGTH).toBe(2000);
    expect(SLACK_CONTENT_MAX_LENGTH).toBe(4000);
  });
});

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
    expect(resolveMessageText({ content: '  padded content  ' }, {})).toBe('padded content');
  });

  it('preserves null-byte content for node-level rejection', () => {
    // Slack/Discord nodes reject null bytes after resolve
    expect(resolveMessageText({ content: `bad${'\0'}text` }, {})).toContain('\0');
    expect(resolveMessageText({}, { text: `hi${'\0'}there` })).toContain('\0');
  });

  it('treats whitespace-only templates as missing and tries next config key', () => {
    expect(resolveMessageText({ textTemplate: '   ' }, { text: 'upstream' })).toBe('upstream');
    expect(
      resolveMessageText(
        { textTemplate: '   ', content: 'from content' },
        { text: 'upstream' },
      ),
    ).toBe('from content');
  });

  it('falls back to inputs.text then JSON of inputs', () => {
    expect(resolveMessageText({}, { text: 'upstream' })).toBe('upstream');
    expect(resolveMessageText({}, { text: '  padded  ' })).toBe('padded');
    expect(resolveMessageText({}, { a: 1 })).toBe('{"a":1}');
    expect(resolveMessageText(undefined, {})).toBe('');
  });

  it('JSON-stringifies non-string input values in templates', () => {
    expect(
      resolveMessageText({ textTemplate: 'obj={{data}}' }, { data: { ok: true } }),
    ).toBe('obj={"ok":true}');
  });

  it('skips unsafe placeholder keys during interpolation', () => {
    expect(
      resolveMessageText(
        { textTemplate: 'a={{ok}} b={{bad key}} c={{x.y}}' },
        { ok: '1', 'bad key': 'NO', 'x.y': 'NO' },
      ),
    ).toBe('a=1 b={{bad key}} c={{x.y}}');
  });

  it('caps resolved message text length', async () => {
    const { MESSAGE_TEXT_MAX_CHARS } = await import('./message-text.js');
    const text = resolveMessageText({ text: 'x'.repeat(MESSAGE_TEXT_MAX_CHARS + 50) }, {});
    expect(text.length).toBe(MESSAGE_TEXT_MAX_CHARS);
  });

  it('caps placeholder replacement length and skips overlong keys', () => {
    const long = 'v'.repeat(20_000);
    const out = resolveMessageText({ textTemplate: 'x={{k}}' }, { k: long });
    expect(out.length).toBeLessThanOrEqual(8_000 + 2); // 'x=' + capped replacement
    expect(out.startsWith('x=')).toBe(true);
    // Overlong key name is skipped
    const longKey = 'k'.repeat(101);
    expect(
      resolveMessageText(
        { textTemplate: `{{${longKey}}}` },
        { [longKey]: 'NO' },
      ),
    ).toBe(`{{${longKey}}}`);
  });

  it('interpolates at most 100 placeholder keys (fan-out cap)', () => {
    const inputs: Record<string, unknown> = {};
    const parts: string[] = [];
    for (let i = 0; i < 120; i++) {
      const k = `k${i}`;
      inputs[k] = `v${i}`;
      parts.push(`{{${k}}}`);
    }
    const out = resolveMessageText({ textTemplate: parts.join(' ') }, inputs);
    // First 100 keys replaced
    expect(out).toContain('v0');
    expect(out).toContain('v99');
    // Keys beyond the cap remain as placeholders
    expect(out).toContain('{{k100}}');
    expect(out).toContain('{{k119}}');
    expect(out).not.toContain('v100');
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

  it('trims upstream query/text and treats whitespace-only as empty', () => {
    expect(resolveSearchQuery({}, { query: '  hello  ' })).toBe('hello');
    expect(resolveSearchQuery({}, { text: '   ' })).toBe('');
    expect(resolveSearchQuery({}, { query: '   ' })).toBe('');
  });

  it('rejects control-char queries and caps length', () => {
    expect(resolveSearchQuery({ query: 'hi\nthere' }, {})).toBe('');
    expect(resolveSearchQuery({}, { query: 'a'.repeat(2_500) }).length).toBe(2_000);
  });
});
