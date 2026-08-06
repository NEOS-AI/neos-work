/**
 * Canvas overlay enabled state: explicit prop > env > localStorage pref > default on (Q23).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  isCanvasOverlayEnabled,
  writeCanvasOverlayPref,
} from './canvas-style.js';

/**
 * @param explicit - controlled `canvasOverlay` prop from host (true/false/undefined)
 * @param htmlLike - only meaningful for HTML-like entry files
 */
export function useCanvasOverlayPref(
  explicit: boolean | null | undefined,
  htmlLike: boolean,
): {
  canvasOn: boolean;
  toggleCanvasOverlay: () => void;
} {
  const [userOn, setUserOn] = useState(() => isCanvasOverlayEnabled(explicit));

  // Sync when controlled prop changes
  useEffect(() => {
    if (explicit === true || explicit === false) {
      setUserOn(explicit);
    }
  }, [explicit]);

  // Re-read when uncontrolled and htmlLike becomes true (mount/open file)
  useEffect(() => {
    if (explicit === true || explicit === false) return;
    setUserOn(isCanvasOverlayEnabled());
  }, [explicit, htmlLike]);

  const canvasOn = htmlLike && userOn;

  const toggleCanvasOverlay = useCallback(() => {
    if (explicit === true || explicit === false) {
      // Controlled host: still persist pref for next uncontrolled mount
      writeCanvasOverlayPref(!explicit);
      return;
    }
    setUserOn((prev) => {
      const next = !prev;
      writeCanvasOverlayPref(next);
      return next;
    });
  }, [explicit]);

  return { canvasOn, toggleCanvasOverlay };
}
