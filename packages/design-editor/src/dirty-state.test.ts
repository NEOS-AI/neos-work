import { describe, expect, it } from 'vitest';
import {
  createEmptyBuffer,
  isConflict,
  isDirty,
  reduceEditorBuffer,
  simpleDiffLines,
} from './dirty-state.js';

describe('editor buffer state machine', () => {
  it('opens clean, edits dirty, saves clean', () => {
    let s = createEmptyBuffer();
    s = reduceEditorBuffer(s, { type: 'open', path: 'index.html', content: 'v1' });
    expect(isDirty(s)).toBe(false);
    s = reduceEditorBuffer(s, { type: 'edit', content: 'v2' });
    expect(isDirty(s)).toBe(true);
    s = reduceEditorBuffer(s, { type: 'saved', content: 'v2', hash: 'h2' });
    expect(isDirty(s)).toBe(false);
    expect(s.disk).toBe('v2');
  });

  it('accepts disk-changed when clean', () => {
    let s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'a',
    });
    s = reduceEditorBuffer(s, { type: 'disk-changed', content: 'agent' });
    expect(s.local).toBe('agent');
    expect(s.disk).toBe('agent');
    expect(isConflict(s)).toBe(false);
  });

  it('enters conflict when dirty + disk-changed; keep / take / merge', () => {
    let s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
    });
    s = reduceEditorBuffer(s, { type: 'edit', content: 'mine' });
    s = reduceEditorBuffer(s, { type: 'disk-changed', content: 'agent' });
    expect(isConflict(s)).toBe(true);
    expect(s.local).toBe('mine');
    expect(s.pendingDisk).toBe('agent');

    const keep = reduceEditorBuffer(s, { type: 'resolve-conflict', choice: 'keep-mine' });
    expect(isConflict(keep)).toBe(false);
    expect(keep.local).toBe('mine');
    expect(keep.disk).toBe('agent');
    expect(isDirty(keep)).toBe(true);

    const take = reduceEditorBuffer(s, { type: 'resolve-conflict', choice: 'take-agent' });
    expect(take.local).toBe('agent');
    expect(isDirty(take)).toBe(false);

    const merge = reduceEditorBuffer(s, {
      type: 'resolve-conflict',
      choice: 'diff',
      merged: 'merged',
    });
    expect(merge.local).toBe('merged');
    expect(merge.disk).toBe('agent');
    expect(isDirty(merge)).toBe(true);
  });

  it('simpleDiffLines counts changes', () => {
    const d = simpleDiffLines('a\nb\n', 'a\nc\n');
    expect(d.removed).toBeGreaterThanOrEqual(1);
    expect(d.added).toBeGreaterThanOrEqual(1);
    expect(d.preview.some((l) => l.startsWith('-') || l.startsWith('+'))).toBe(true);
  });
});
