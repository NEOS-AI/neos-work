import { describe, expect, it } from 'vitest';
import { alignBoxKey, applyHtmlBufferMutation } from './html-buffer-mutate.js';

describe('applyHtmlBufferMutation', () => {
  it('returns null when mutate is a no-op', () => {
    const html = '<div data-neos-id="e1">x</div>';
    expect(
      applyHtmlBufferMutation({
        local: html,
        mutate: (h) => h,
      }),
    ).toBeNull();
  });

  it('stamps missing neos ids then mutates', () => {
    const html = '<body><p>hi</p></body>';
    const next = applyHtmlBufferMutation({
      local: html,
      ensureNeosIds: ['e1'],
      mutate: (h) => {
        expect(h).toContain('data-neos-id');
        return `${h}<!--x-->`;
      },
    });
    expect(next).toContain('data-neos-id');
    expect(next).toContain('<!--x-->');
  });

  it('alignBoxKey prefers neosId', () => {
    expect(alignBoxKey({ neosId: 'a', elementId: 'x' })).toBe('n:a');
    expect(alignBoxKey({ elementId: 'x' })).toBe('e:x');
    expect(alignBoxKey({})).toBe('');
  });
});
