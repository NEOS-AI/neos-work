import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createEmptyWorkbookSnapshot,
  serializeWorkbookSnapshot,
} from '../snapshot.js';

type EditorBufferState = {
  path: string | null;
  local: string;
  disk: string;
  diskHash?: string | null;
  pendingDisk: string | null;
  pendingDiskHash?: string | null;
};

const LABELS = {
  save: 'Save',
  dirty: 'Unsaved',
  conflictTitle: 'The sheet on disk differs from local edits.',
  keepMine: 'Keep mine',
  takeAgent: 'Take disk version',
  showDiff: 'Show diff',
  dismissDiff: 'Hide diff',
  parseFailed: 'Could not open this spreadsheet. Check that the JSON is a valid workbook.',
  loading: 'Loading sheet…',
};

const snapshot = createEmptyWorkbookSnapshot({ id: 'wb1', locale: 'enUS' });
const snapshotText = serializeWorkbookSnapshot(snapshot);

const dispose = vi.fn();
const disableShortcut = vi.fn();
const enableShortcut = vi.fn();
const createWorkbook = vi.fn();
const addEvent = vi.fn();
const save = vi.fn(() => snapshot);
const createUniver = vi.fn();

vi.mock('@univerjs/presets', () => ({
  LocaleType: { EN_US: 'enUS', KO_KR: 'koKR' },
  mergeLocales: (...packs: unknown[]) => packs,
  createUniver: (...args: unknown[]) => createUniver(...args),
}));

vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: (opts: unknown) => ({ preset: 'sheets-core', opts }),
}));

vi.mock('@univerjs/preset-sheets-core/lib/index.css', () => ({}));
vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({ default: { en: true } }));
vi.mock('@univerjs/preset-sheets-core/locales/ko-KR', () => ({ default: { ko: true } }));
vi.mock('@univerjs/preset-sheets-core/worker?worker&url', () => ({
  default: '/mock-univer-formula-worker.js',
}));

class MockWorker {
  url: URL | string;
  options?: WorkerOptions;
  terminate = vi.fn();
  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
  }
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false;
  }
  onmessage = null;
  onerror = null;
  onmessageerror = null;
}

function presetOpts(): { container?: HTMLElement; workerURL?: unknown } {
  const boot = createUniver.mock.calls[0]?.[0] as {
    presets: Array<{ opts: { container?: HTMLElement; workerURL?: unknown } }>;
  };
  return boot.presets[0]?.opts ?? {};
}

function openBuffer(
  content = snapshotText,
  path = 'budget.univer.json',
  extra: Partial<EditorBufferState> = {},
): EditorBufferState {
  return {
    path,
    local: content,
    disk: content,
    diskHash: 'h1',
    pendingDisk: null,
    pendingDiskHash: null,
    ...extra,
  };
}

function dirtyBuffer(): EditorBufferState {
  const local = serializeWorkbookSnapshot({ ...snapshot, name: 'Edited' });
  return { ...openBuffer(), local };
}

function sheetValueHandler(): (() => void) | undefined {
  const hit = addEvent.mock.calls.find((c) => c[0] === 'SheetValueChanged');
  return hit?.[1] as (() => void) | undefined;
}

const { SheetsPane } = await import('./SheetsPane.js');

describe('SheetsPane', () => {
  beforeEach(() => {
    dispose.mockReset();
    disableShortcut.mockReset();
    enableShortcut.mockReset();
    save.mockReset().mockImplementation(() => snapshot);
    addEvent.mockReset().mockReturnValue({ dispose: vi.fn() });
    createWorkbook.mockReset().mockReturnValue({ save });
    createUniver.mockReset().mockReturnValue({
      univer: { dispose },
      univerAPI: {
        Event: { SheetValueChanged: 'SheetValueChanged' },
        createWorkbook,
        addEvent,
        getShortcut: () => ({ enableShortcut, disableShortcut }),
      },
    });
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.getElementById('univer-theme-css-variables')?.remove();
    document.documentElement.classList.remove('univer-dark');
  });

  it('serializes onEdit with pretty JSON and trailing newline', async () => {
    const onEdit = vi.fn();
    const edited = { ...snapshot, name: 'Edited' };
    save.mockImplementation(() => edited);
    render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={onEdit}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );

    await waitFor(() => expect(addEvent).toHaveBeenCalled());
    const boot = createUniver.mock.calls[0]?.[0] as {
      collaboration?: unknown;
      presets: Array<{ opts: { container?: unknown; workerURL?: unknown } }>;
    };
    expect(boot).not.toHaveProperty('collaboration');
    expect(boot.presets[0]?.opts.container).toBeInstanceOf(HTMLElement);
    expect(boot.presets[0]?.opts).not.toHaveProperty('workerURL');
    expect(addEvent.mock.calls.every((c) => c[0] === 'SheetValueChanged')).toBe(true);
    const handler = sheetValueHandler();
    expect(handler).toEqual(expect.any(Function));

    await act(async () => {
      handler?.();
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(onEdit).toHaveBeenCalled();
    const arg = onEdit.mock.calls.at(-1)?.[0] as string;
    expect(arg.endsWith('\n')).toBe(true);
    expect(arg).toBe(serializeWorkbookSnapshot(edited));
    expect(arg).not.toBe(JSON.stringify(edited));
    expect(arg).toContain('\n  ');
  });

  it('does not call onEdit on mount without user edits', async () => {
    const onEdit = vi.fn();
    render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={onEdit}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createWorkbook).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('save-button click calls parent onSave once and is disabled when clean', async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={onSave}
        labels={LABELS}
      />,
    );
    const cleanBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(cleanBtn.disabled).toBe(true);
    fireEvent.click(cleanBtn);
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <SheetsPane
        buffer={dirtyBuffer()}
        onEdit={vi.fn()}
        onSave={onSave}
        labels={LABELS}
      />,
    );
    const dirtyBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(dirtyBtn.disabled).toBe(false);
    fireEvent.click(dirtyBtn);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl+S saves when pane is focused and dirty', async () => {
    const onSave = vi.fn();
    render(
      <SheetsPane
        buffer={dirtyBuffer()}
        onEdit={vi.fn()}
        onSave={onSave}
        labels={LABELS}
      />,
    );
    const pane = screen.getByTestId('sheets-pane');
    pane.focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl+S does not save when unfocused or clean', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SheetsPane
        buffer={dirtyBuffer()}
        onEdit={vi.fn()}
        onSave={onSave}
        labels={LABELS}
      />,
    );
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(0);

    rerender(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={onSave}
        labels={LABELS}
      />,
    );
    screen.getByTestId('sheets-pane').focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(0);
  });

  it('ignores SheetValueChanged until ready', async () => {
    const onEdit = vi.fn();
    const edited = { ...snapshot, name: 'Edited' };
    save.mockImplementation(() => edited);
    addEvent.mockImplementation((_ev: unknown, handler: () => void) => {
      handler();
      return { dispose: vi.fn() };
    });
    render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={onEdit}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(addEvent).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(onEdit).toHaveBeenCalledTimes(0);
  });

  it('does not remount Univer after the first onEdit dirties the buffer', async () => {
    const onEdit = vi.fn();
    const edited = { ...snapshot, name: 'Edited' };
    save.mockImplementation(() => edited);
    const { rerender } = render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={onEdit}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createWorkbook).toHaveBeenCalledTimes(1));
    const handler = sheetValueHandler();
    await act(async () => {
      handler?.();
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(onEdit).toHaveBeenCalled();
    rerender(
      <SheetsPane
        buffer={dirtyBuffer()}
        onEdit={onEdit}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    expect(createWorkbook).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('shows conflict-banner with keep-mine and take-agent', () => {
    const onResolveConflict = vi.fn();
    const buffer = openBuffer(snapshotText, 'budget.univer.json', {
      local: dirtyBuffer().local,
      pendingDisk: serializeWorkbookSnapshot({
        ...snapshot,
        name: 'Disk',
      }),
    });
    render(
      <SheetsPane
        buffer={buffer}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
        onResolveConflict={onResolveConflict}
      />,
    );
    expect(screen.getByTestId('conflict-banner')).toBeTruthy();
    fireEvent.click(screen.getByText(LABELS.keepMine));
    expect(onResolveConflict).toHaveBeenCalledWith('keep-mine');
    fireEvent.click(screen.getByText(LABELS.takeAgent));
    expect(onResolveConflict).toHaveBeenCalledWith('take-agent');
  });

  it('remounts Univer when a clean buffer.local changes', async () => {
    const { rerender } = render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createWorkbook).toHaveBeenCalledTimes(1));

    const next = serializeWorkbookSnapshot({ ...snapshot, name: 'Reloaded' });
    rerender(
      <SheetsPane
        buffer={openBuffer(next, 'budget.univer.json', { diskHash: 'h2' })}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => {
      expect(dispose).toHaveBeenCalled();
      expect(createWorkbook).toHaveBeenCalledTimes(2);
    });
  });

  it('shows parseFailed and does not mount Univer', () => {
    render(
      <SheetsPane
        buffer={openBuffer('{not-json', 'budget.univer.json')}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    expect(screen.getByText(LABELS.parseFailed)).toBeTruthy();
    expect(createUniver).not.toHaveBeenCalled();
    expect(screen.queryByTestId('design-editor')).toBeNull();
  });

  it('passes a Worker instance when formulaWorker is enabled', async () => {
    const { unmount } = render(
      <SheetsPane
        formulaWorker
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createUniver).toHaveBeenCalled());
    const workerURL = presetOpts().workerURL as MockWorker;
    expect(workerURL).toBeInstanceOf(Worker);
    expect(workerURL.options?.type).toBe('module');
    const href = String(workerURL.url);
    expect(href).toContain('mock-univer-formula-worker.js');
    expect(href).not.toContain('/api/workers');
    unmount();
    expect(workerURL.terminate).toHaveBeenCalledTimes(1);
  });

  it('clears theme CSS, univer-dark, and disables shortcuts on unmount', async () => {
    const style = document.createElement('style');
    style.id = 'univer-theme-css-variables';
    document.head.append(style);
    document.documentElement.classList.add('univer-dark');

    const { unmount } = render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createUniver).toHaveBeenCalled());
    const disableBeforeUnmount = disableShortcut.mock.calls.length;

    unmount();

    expect(document.getElementById('univer-theme-css-variables')).toBeNull();
    expect(document.documentElement.classList.contains('univer-dark')).toBe(false);
    expect(disableShortcut.mock.calls.length).toBeGreaterThan(disableBeforeUnmount);
  });

  it('enables shortcuts on host focusin and disables on outside focusin', async () => {
    render(
      <SheetsPane
        buffer={openBuffer()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createUniver).toHaveBeenCalled());
    const host = presetOpts().container;
    expect(host).toBeInstanceOf(HTMLElement);

    enableShortcut.mockClear();
    disableShortcut.mockClear();
    fireEvent.focusIn(host!);
    expect(enableShortcut).toHaveBeenCalled();

    disableShortcut.mockClear();
    fireEvent.focusIn(document.body);
    expect(disableShortcut).toHaveBeenCalled();
  });

  it('does not dispose on dirty file.changed and shows the conflict bar', async () => {
    const { rerender } = render(
      <SheetsPane
        buffer={dirtyBuffer()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );
    await waitFor(() => expect(createWorkbook).toHaveBeenCalledTimes(1));
    dispose.mockClear();

    rerender(
      <SheetsPane
        buffer={{
          ...dirtyBuffer(),
          pendingDisk: serializeWorkbookSnapshot({ ...snapshot, name: 'Disk' }),
          pendingDiskHash: 'h-disk',
        }}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        labels={LABELS}
      />,
    );

    expect(dispose).not.toHaveBeenCalled();
    expect(createWorkbook).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('conflict-banner')).toBeTruthy();
  });
});
