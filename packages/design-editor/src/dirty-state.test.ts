import { describe, expect, it } from 'vitest';
import {
  createEmptyBuffer,
  isConflict,
  isDirty,
  reduceEditorBuffer,
  shouldSkipDiskReload,
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

describe('dirty-state edge cases', () => {
  it('ignores edit/saved/disk-changed when no path open', () => {
    const empty = createEmptyBuffer();
    expect(reduceEditorBuffer(empty, { type: 'edit', content: 'x' })).toBe(empty);
    expect(reduceEditorBuffer(empty, { type: 'saved', content: 'x' })).toBe(empty);
    expect(reduceEditorBuffer(empty, { type: 'disk-changed', content: 'x' })).toBe(empty);
    expect(reduceEditorBuffer(empty, { type: 'resolve-conflict', choice: 'keep-mine' })).toBe(
      empty,
    );
  });

  it('disk-changed ignores identical tip; saved keeps conflict if still diverged', () => {
    let s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
      hash: 'h1',
    });
    const same = reduceEditorBuffer(s, { type: 'disk-changed', content: 'base', hash: 'h1' });
    expect(same).toEqual(s);
    // Hash-only short circuit (content string could be anything if hash matches)
    const sameHash = reduceEditorBuffer(s, {
      type: 'disk-changed',
      content: 'base-but-would-be-same-hash',
      hash: 'h1',
    });
    expect(sameHash).toEqual(s);

    s = reduceEditorBuffer(s, { type: 'edit', content: 'mine' });
    s = reduceEditorBuffer(s, { type: 'disk-changed', content: 'agent', hash: 'ha' });
    // save local that still differs from pending → keep pending
    const savedDiverged = reduceEditorBuffer(s, { type: 'saved', content: 'mine2' });
    expect(savedDiverged.pendingDisk).toBe('agent');
    // save matching agent tip clears conflict
    const savedMatch = reduceEditorBuffer(s, { type: 'saved', content: 'agent' });
    expect(savedMatch.pendingDisk).toBeNull();
  });

  it('diff resolve without merged leaves conflict open', () => {
    let s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
    });
    s = reduceEditorBuffer(s, { type: 'edit', content: 'mine' });
    s = reduceEditorBuffer(s, { type: 'disk-changed', content: 'agent' });
    const still = reduceEditorBuffer(s, { type: 'resolve-conflict', choice: 'diff' });
    expect(isConflict(still)).toBe(true);
  });

  it('shouldSkipDiskReload uses event hash vs disk/pending tips', () => {
    let s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
      hash: 'h1',
    });
    expect(shouldSkipDiskReload(s, { path: 'a.html', hash: 'h1' })).toBe(true);
    expect(shouldSkipDiskReload(s, { path: 'a.html', hash: 'h2' })).toBe(false);
    expect(shouldSkipDiskReload(s, { path: 'other.html', hash: 'h2' })).toBe(true);
    expect(shouldSkipDiskReload(s, { path: 'a.html' })).toBe(false);

    s = reduceEditorBuffer(s, { type: 'edit', content: 'mine' });
    s = reduceEditorBuffer(s, { type: 'disk-changed', content: 'agent', hash: 'ha' });
    expect(shouldSkipDiskReload(s, { path: 'a.html', hash: 'ha' })).toBe(true);
    expect(shouldSkipDiskReload(s, { path: 'a.html', hash: 'hb' })).toBe(false);
  });

  it('unknown event types leave state unchanged', () => {
    const s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'x',
    });
    // @ts-expect-error intentional invalid event for default branch
    expect(reduceEditorBuffer(s, { type: 'nope' })).toBe(s);
  });
});
