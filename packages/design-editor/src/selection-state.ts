/**
 * Unified SelectionState for Layers + Inspect + Edit with AI (Task 1c).
 */

import type { EditContext, SelectionState } from '@neos-work/shared';
import type { BridgeSelectPayload } from './bridge-types.js';

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
  return (
    a.filePath === b.filePath
    && (a.selector ?? '') === (b.selector ?? '')
    && (a.layerId ?? '') === (b.layerId ?? '')
  );
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
