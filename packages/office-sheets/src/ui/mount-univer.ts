import '@univerjs/preset-sheets-core/lib/index.css';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import UniverPresetSheetsCoreKoKR from '@univerjs/preset-sheets-core/locales/ko-KR';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import {
  localeFromNeosI18n,
  serializeWorkbookSnapshot,
  type UniverWorkbookSnapshot,
} from '../snapshot.js';

const DIRTY_DEBOUNCE_MS = 200;

export interface MountUniverHandle {
  dispose: () => void;
}

export function mountUniver(opts: {
  hostEl: HTMLElement;
  snapshot: UniverWorkbookSnapshot;
  locale?: string;
  getDisk: () => string;
  onEdit: (content: string) => void;
}): MountUniverHandle {
  const { hostEl, snapshot, locale, getDisk, onEdit } = opts;
  const univerLocale =
    localeFromNeosI18n(locale) === 'koKR' ? LocaleType.KO_KR : LocaleType.EN_US;
  const { univer, univerAPI } = createUniver({
    locale: univerLocale,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
      [LocaleType.KO_KR]: mergeLocales(UniverPresetSheetsCoreKoKR),
    },
    presets: [
      UniverSheetsCorePreset({
        container: hostEl,
      }),
    ],
  });

  const shortcut = univerAPI.getShortcut();
  shortcut.disableShortcut();

  let ready = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const onHostFocusIn = () => {
    if (!disposed) shortcut.enableShortcut();
  };
  const onDocFocusIn = (ev: FocusEvent) => {
    if (disposed) return;
    const target = ev.target;
    if (target instanceof Node && hostEl.contains(target)) return;
    shortcut.disableShortcut();
  };
  hostEl.addEventListener('focusin', onHostFocusIn);
  document.addEventListener('focusin', onDocFocusIn);

  let fWorkbook: { save: () => unknown } | undefined;

  const flushDirty = () => {
    if (disposed || !ready || !fWorkbook) return;
    try {
      const serialized = serializeWorkbookSnapshot(
        fWorkbook.save() as UniverWorkbookSnapshot,
      );
      if (serialized === getDisk()) return;
      onEdit(serialized);
    } catch {
      // ignore serialize failures from a tearing-down instance
    }
  };

  const onSheetValueChanged = () => {
    if (!ready || disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushDirty, DIRTY_DEBOUNCE_MS);
  };

  const eventKey = univerAPI.Event.SheetValueChanged;
  const eventDisposable = univerAPI.addEvent(eventKey, onSheetValueChanged);
  fWorkbook = univerAPI.createWorkbook(snapshot as never);
  ready = true;

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      hostEl.removeEventListener('focusin', onHostFocusIn);
      document.removeEventListener('focusin', onDocFocusIn);
      try {
        shortcut.disableShortcut();
      } catch {
        // facade may already be gone
      }
      try {
        eventDisposable?.dispose?.();
      } catch {
        // ignore
      }
      try {
        univer.dispose();
      } catch {
        // ignore
      }
      hostEl.replaceChildren();
      document.getElementById('univer-theme-css-variables')?.remove();
      document.documentElement.classList.remove('univer-dark');
    },
  };
}
