/**
 * Single path for HTML buffer mutations in the Design Editor:
 * optional stamp of data-neos-id → pure mutate → null if unchanged.
 */

import { stampNeosIds } from './html-layers.js';

export type HtmlBufferMutateOpts = {
  /** Current editor buffer HTML. */
  local: string;
  /**
   * If any of these neos ids are missing from the buffer, stamp ids first.
   * Pass empty/omit to never stamp (or pass a single id that needs stamping).
   */
  ensureNeosIds?: Array<string | null | undefined>;
  /** Pure transform; return same string if no change. */
  mutate: (html: string) => string;
};

/**
 * Prepare HTML (stamp if needed), run mutate, return next HTML or null if no-op.
 */
export function applyHtmlBufferMutation(opts: HtmlBufferMutateOpts): string | null {
  const { local, mutate } = opts;
  if (typeof local !== 'string') return null;

  let base = local;
  const ids = (opts.ensureNeosIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (ids.some((id) => !base.includes(`data-neos-id="${id}"`))) {
    base = stampNeosIds(base);
  }

  const next = mutate(base);
  if (typeof next !== 'string' || next === base || next === local) return null;
  return next;
}

/** Align/distribute identity key for multi-select bbox maps. */
export function alignBoxKey(box: {
  neosId?: string | null;
  elementId?: string | null;
}): string {
  if (box.neosId) return `n:${box.neosId}`;
  if (box.elementId) return `e:${box.elementId}`;
  return '';
}
