/**
 * Unified SelectionState for Layers + Inspect + Edit with AI (Task 1c).
 * Multi-select helpers (v0.7 M3).
 */

import type { EditContext, SelectionState } from '@neos-work/shared';
import type { BridgeSelectPayload } from './bridge-types.js';
import type { CanvasBBox } from './CanvasOverlay.js';

export function createEmptySelection(): SelectionState | null {
  return null;
}

export function selectionFromLayer(
  filePath: string,
  layer: { id: string; selector: string },
): SelectionState {
  return {
    filePath,
    selector: layer.selector,
    layerId: layer.id,
  };
}

export function selectionFromBridge(
  filePath: string,
  payload: BridgeSelectPayload,
  layerId?: string,
): SelectionState {
  return {
    filePath,
    selector: payload.selector,
    layerId,
  };
}

export function selectionEquals(
  a: SelectionState | null | undefined,
  b: SelectionState | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const multiA = (a.multiSelectors ?? []).join('\0');
  const multiB = (b.multiSelectors ?? []).join('\0');
  return (
    a.filePath === b.filePath
    && (a.selector ?? '') === (b.selector ?? '')
    && (a.layerId ?? '') === (b.layerId ?? '')
    && multiA === multiB
  );
}

/**
 * Attach multi-select selector list to primary selection (v0.8 M3 collab).
 * Ordered list; last entry is primary. Single selection omits multi fields.
 */
export function selectionWithMulti(
  primary: SelectionState,
  entries: Array<{ selection: SelectionState }>,
): SelectionState {
  const selectors = entries
    .map((e) => e.selection.selector)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  const layerIds = entries
    .map((e) => e.selection.layerId)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (selectors.length <= 1) {
    const { multiSelectors: _ms, multiLayerIds: _ml, ...rest } = primary;
    return rest;
  }
  return {
    ...primary,
    multiSelectors: selectors,
    multiLayerIds: layerIds.length > 0 ? layerIds : undefined,
  };
}

/** One entry in a multi-selection set (primary is last). */
export type MultiSelectEntry = {
  selection: SelectionState;
  detail: BridgeSelectPayload | null;
};

/** Flatten bridge multi payload into ordered entries (last = primary). */
export function multiEntriesFromBridge(
  filePath: string,
  payload: BridgeSelectPayload,
  resolveLayerId: (selector: string) => string | undefined,
): MultiSelectEntry[] {
  const flat =
    payload.multi && payload.multi.length > 0
      ? payload.multi
      : [
          {
            selector: payload.selector,
            tag: payload.tag,
            outerHTML: payload.outerHTML,
            bbox: payload.bbox,
          },
        ];
  return flat.map((p) => ({
    selection: selectionFromBridge(filePath, p as BridgeSelectPayload, resolveLayerId(p.selector)),
    detail: {
      selector: p.selector,
      tag: p.tag,
      outerHTML: p.outerHTML,
      bbox: p.bbox,
    },
  }));
}

/**
 * Toggle a layer into/out of multi-selection (Shift+click).
 * Returns ordered list with last = primary. Empty when last item deselected.
 */
export function toggleMultiSelectLayer(
  current: MultiSelectEntry[],
  filePath: string,
  layer: { id: string; selector: string; tag?: string },
): MultiSelectEntry[] {
  const nextItem: MultiSelectEntry = {
    selection: selectionFromLayer(filePath, layer),
    detail: {
      selector: layer.selector,
      tag: layer.tag ?? 'div',
    },
  };
  const key = layer.selector || layer.id;
  const idx = current.findIndex(
    (e) =>
      (e.selection.selector && e.selection.selector === layer.selector)
      || (e.selection.layerId && e.selection.layerId === layer.id)
      || e.selection.selector === key,
  );
  if (idx >= 0) {
    return current.filter((_, i) => i !== idx);
  }
  return [...current, nextItem];
}

/** Split ordered multi list into primary + extras. */
export function splitPrimaryExtras(entries: MultiSelectEntry[]): {
  primary: MultiSelectEntry | null;
  extras: MultiSelectEntry[];
} {
  if (entries.length === 0) return { primary: null, extras: [] };
  if (entries.length === 1) return { primary: entries[0]!, extras: [] };
  return {
    primary: entries[entries.length - 1]!,
    extras: entries.slice(0, -1),
  };
}

/** Collect canvas bboxes from multi entries (primary last). */
export function bboxesFromMultiEntries(entries: MultiSelectEntry[]): {
  primary: CanvasBBox | null;
  extras: CanvasBBox[];
} {
  const boxes = entries
    .map((e) => e.detail?.bbox)
    .filter((b): b is NonNullable<typeof b> => Boolean(b && b.width > 0 && b.height > 0))
    .map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  if (boxes.length === 0) return { primary: null, extras: [] };
  if (boxes.length === 1) return { primary: boxes[0]!, extras: [] };
  return { primary: boxes[boxes.length - 1]!, extras: boxes.slice(0, -1) };
}

/** Build EditContext for selection-scoped AI refine (Q10 default replace-selection). */
export function editContextFromSelection(
  selection: SelectionState,
  opts?: {
    snippet?: string;
    mode?: EditContext['mode'];
  },
): EditContext {
  return {
    filePath: selection.filePath,
    mode: opts?.mode ?? 'replace-selection',
    selection: selection.selector ? { selector: selection.selector } : undefined,
    snippet: opts?.snippet,
  };
}
