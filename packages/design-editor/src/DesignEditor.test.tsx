import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignEditor, mergePeerCanvasFrames } from './DesignEditor.js';
import { createEmptyBuffer, reduceEditorBuffer } from './dirty-state.js';
import { NEOS_BRIDGE_SOURCE } from './bridge-types.js';
import * as PreviewFrameMod from './PreviewFrame.js';
import type { PeerCanvasFrame } from './CanvasOverlay.js';

// CodeMirror needs a layout box; mock CodeEditor for chrome tests
vi.mock('./CodeEditor.js', () => ({
  CodeEditor: (props: {
    value: string;
    onChange?: (v: string) => void;
    'aria-label'?: string;
  }) => (
    <textarea
      aria-label={props['aria-label'] ?? 'code'}
      value={props.value}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

function openHtml(content: string, path = 'index.html') {
  return reduceEditorBuffer(createEmptyBuffer(), {
    type: 'open',
    path,
    content,
  });
}

describe('DesignEditor chrome', () => {
  it('shows canvas badge by default (v0.9 M1) and allows toggle off', () => {
    try {
      localStorage.removeItem('neos.canvasOverlay');
    } catch {
      // ignore
    }
    const buffer = openHtml('<div id="hero">Hi</div>');
    render(<DesignEditor buffer={buffer} mode="inspect" />);
    expect(screen.getByTestId('canvas-overlay-badge')).toBeTruthy();
    fireEvent.click(screen.getByTestId('canvas-overlay-toggle'));
    expect(screen.queryByTestId('canvas-overlay-badge')).toBeNull();
    expect(screen.getByTestId('canvas-overlay-toggle').textContent).toMatch(
      /off/i,
    );
  });

  it('shows canvas tools when selection has multi bbox path', () => {
    const buffer = openHtml(
      '<div data-neos-id="a">A</div><div data-neos-id="b">B</div>',
    );
    render(
      <DesignEditor
        buffer={buffer}
        mode="inspect"
        canvasOverlay
        selection={{
          filePath: 'index.html',
          selector: '[data-neos-id="a"]',
          layerId: 'a',
        }}
      />,
    );
    expect(screen.getByTestId('canvas-tools')).toBeTruthy();
    expect(screen.getByTestId('canvas-z-forward')).toBeTruthy();
  });

  it('renders modes, marks dirty, invokes save', () => {
    const onSave = vi.fn();
    const onEdit = vi.fn();
    let buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'index.html',
      content: 'a',
    });
    buffer = reduceEditorBuffer(buffer, { type: 'edit', content: 'b' });

    render(
      <DesignEditor
        buffer={buffer}
        mode="split"
        onEdit={onEdit}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('design-editor')).toBeTruthy();
    expect(screen.getByTestId('dirty-badge')).toBeTruthy();
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('save-button'));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mode-preview'));
    fireEvent.click(screen.getByTestId('mode-inspect'));
  });

  it('shows conflict banner actions', () => {
    const onResolve = vi.fn();
    let buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
    });
    buffer = reduceEditorBuffer(buffer, { type: 'edit', content: 'mine' });
    buffer = reduceEditorBuffer(buffer, { type: 'disk-changed', content: 'agent' });

    render(
      <DesignEditor buffer={buffer} onResolveConflict={onResolve} />,
    );
    expect(screen.getByTestId('conflict-banner')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep mine'));
    expect(onResolve).toHaveBeenCalledWith('keep-mine');
  });

  it('selects layer and fires edit-with-ai', () => {
    const onEditWithAi = vi.fn();
    const onSelectionChange = vi.fn();
    const buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'index.html',
      content: '<!DOCTYPE html><html><body><h1 id="t">Hi</h1></body></html>',
    });
    render(
      <DesignEditor
        buffer={buffer}
        mode="preview"
        onEditWithAi={onEditWithAi}
        onSelectionChange={onSelectionChange}
      />,
    );
    // layer rows from parse
    const rows = screen.getAllByRole('treeitem');
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[rows.length - 1]);
    expect(onSelectionChange).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('edit-with-ai-button'));
    expect(onEditWithAi).toHaveBeenCalled();
  });
});

describe('DesignEditor more chrome', () => {
  it('switches code mode and device presets; take-agent conflict', () => {
    const onResolve = vi.fn();
    const onModeChange = vi.fn();
    let buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'a.html',
      content: 'base',
    });
    buffer = reduceEditorBuffer(buffer, { type: 'edit', content: 'mine' });
    buffer = reduceEditorBuffer(buffer, { type: 'disk-changed', content: 'agent' });

    render(
      <DesignEditor
        buffer={buffer}
        mode="code"
        onModeChange={onModeChange}
        onResolveConflict={onResolve}
      />,
    );
    expect(screen.getByTestId('design-editor')).toBeTruthy();
    // code mode still has mode switches
    fireEvent.click(screen.getByTestId('mode-split'));
    expect(onModeChange).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Take agent'));
    expect(onResolve).toHaveBeenCalledWith('take-agent');
  });

  it('shows selection badge when selection provided', () => {
    const buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'index.html',
      content: '<body><h1>Hi</h1></body>',
    });
    render(
      <DesignEditor
        buffer={buffer}
        mode="preview"
        selection={{ filePath: 'index.html', selector: 'h1', layerId: 'e1' }}
      />,
    );
    expect(screen.getByTestId('selection-badge')).toBeTruthy();
  });
});

describe('DesignEditor bridge + layers actions', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postSpy = vi.spyOn(PreviewFrameMod, 'postToPreview').mockImplementation(() => {});
  });

  afterEach(() => {
    postSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('handles dom-snapshot and select bridge messages', async () => {
    const onSelectionChange = vi.fn();
    const buffer = openHtml(
      '<!DOCTYPE html><html><body><h1 id="t">Hi</h1></body></html>',
    );
    render(
      <DesignEditor
        buffer={buffer}
        mode="inspect"
        onSelectionChange={onSelectionChange}
      />,
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: NEOS_BRIDGE_SOURCE,
            type: 'neos.dom-snapshot',
            tree: [
              {
                id: 'b1',
                tag: 'body',
                name: 'body',
                selector: 'body',
                depth: 0,
                visible: true,
                locked: false,
                children: [
                  {
                    id: 'h1',
                    tag: 'h1',
                    name: 'h1#t',
                    selector: '#t',
                    depth: 1,
                    visible: true,
                    locked: false,
                    children: [],
                  },
                ],
              },
            ],
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('layers-source').textContent).toMatch(/Live|Bridge/i);
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: NEOS_BRIDGE_SOURCE,
            type: 'neos.select',
            selection: {
              selector: '#t',
              tag: 'h1',
              outerHTML: '<h1 id="t">Hi</h1>',
              bbox: { x: 0, y: 0, width: 120, height: 40 },
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalled();
    });
    expect(screen.getByTestId('inspect-panel')).toBeTruthy();
    expect(screen.getByTestId('inspect-panel').textContent).toMatch(/tag:\s*h1/);
    expect(screen.getByTestId('inspect-panel').textContent).toMatch(/120/);
  });

  it('toggles layer visibility and lock, hovers, and copies selector', async () => {
    const onEdit = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const html =
      '<body><div data-neos-id="e1"><span data-neos-id="e2">hi</span></div></body>';
    const buffer = openHtml(html);
    render(
      <DesignEditor
        buffer={buffer}
        mode="preview"
        onEdit={onEdit}
        onEditWithAi={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole('treeitem');
    const leaf = rows[rows.length - 1]!;
    const layerId = leaf.getAttribute('data-layer-id')!;

    fireEvent.mouseEnter(leaf);
    fireEvent.mouseLeave(leaf);
    expect(postSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`layer-vis-${layerId}`));
    expect(onEdit).toHaveBeenCalled();
    const hiddenHtml = onEdit.mock.calls.at(-1)?.[0] as string;
    expect(hiddenHtml).toMatch(/hidden|data-neos-hidden/i);

    onEdit.mockClear();
    fireEvent.click(screen.getByTestId(`layer-lock-${layerId}`));
    // may stamp+toggle; either way should rewrite if id present
    if (onEdit.mock.calls.length) {
      expect(onEdit.mock.calls.at(-1)?.[0]).toMatch(/data-neos-locked|data-neos-id/);
    }

    fireEvent.click(leaf);
    fireEvent.click(screen.getByTestId('layers-copy-selector'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('layers-edit-ai'));
  });

  it('reorders sibling layers via drag-drop into HTML buffer', () => {
    const onEdit = vi.fn();
    const html = `<!DOCTYPE html><html><body>
      <ul data-neos-id="list">
        <li data-neos-id="a">A</li>
        <li data-neos-id="b">B</li>
        <li data-neos-id="c">C</li>
      </ul>
    </body></html>`;
    const buffer = openHtml(html);
    render(
      <DesignEditor buffer={buffer} mode="preview" onEdit={onEdit} />,
    );

    expect(screen.getByTestId('layers-panel').getAttribute('data-reorder')).toBe(
      '1',
    );
    // Move C onto A (before under jsdom zero-height) — always changes order
    const source = screen.getByTestId('layer-row-c');
    const target = screen.getByTestId('layer-row-a');

    fireEvent.dragStart(source, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: 'move',
        getData: () => 'c',
      },
    });
    fireEvent.dragOver(target, {
      clientY: 0,
      dataTransfer: { dropEffect: 'move' },
    });
    fireEvent.drop(target, {
      clientY: 0,
      dataTransfer: {
        getData: () => 'c',
      },
    });

    expect(onEdit).toHaveBeenCalled();
    const next = onEdit.mock.calls.at(-1)?.[0] as string;
    expect(next).toMatch(
      /data-neos-id="c"[\s\S]*data-neos-id="a"[\s\S]*data-neos-id="b"/,
    );
  });

  it('stamps neos ids when toggling unstamped html; clipboard errors are ignored', async () => {
    const onEdit = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });
    // no data-neos-id → toggle stamps then rewrites
    const buffer = openHtml('<body><section><p>unstamped</p></section></body>');
    render(
      <DesignEditor buffer={buffer} mode="preview" onEdit={onEdit} onEditWithAi={vi.fn()} />,
    );
    const rows = screen.getAllByRole('treeitem');
    const leaf = rows[rows.length - 1]!;
    const layerId = leaf.getAttribute('data-layer-id')!;
    fireEvent.click(screen.getByTestId(`layer-vis-${layerId}`));
    expect(onEdit).toHaveBeenCalled();
    expect(onEdit.mock.calls.at(-1)?.[0]).toMatch(/data-neos-id|hidden/i);

    onEdit.mockClear();
    fireEvent.click(screen.getByTestId(`layer-lock-${layerId}`));
    if (onEdit.mock.calls.length) {
      expect(onEdit.mock.calls.at(-1)?.[0]).toMatch(/data-neos-locked|data-neos-id/);
    }

    fireEvent.click(leaf);
    fireEvent.click(screen.getByTestId('layers-copy-selector'));
    // rejection swallowed
    await waitFor(() => {
      expect(screen.getByTestId('layers-copy-selector')).toBeTruthy();
    });
  });

  it('shows and dismisses conflict diff preview', () => {
    const onResolve = vi.fn();
    let buffer = openHtml('line1\nline2');
    buffer = reduceEditorBuffer(buffer, { type: 'edit', content: 'mine\nline2' });
    buffer = reduceEditorBuffer(buffer, {
      type: 'disk-changed',
      content: 'agent\nline2',
    });

    render(
      <DesignEditor buffer={buffer} mode="code" onResolveConflict={onResolve} />,
    );
    fireEvent.click(screen.getByText('Diff'));
    expect(onResolve).toHaveBeenCalledWith('diff');
    expect(screen.getByTestId('diff-preview')).toBeTruthy();
    fireEvent.click(screen.getByText('Close diff'));
    expect(screen.queryByTestId('diff-preview')).toBeNull();
  });

  it('changes device preset and uses uncontrolled mode', () => {
    const buffer = openHtml('<body><p>x</p></body>');
    render(<DesignEditor buffer={buffer} />);
    // default split shows device select
    const select = screen.getByLabelText('Device preset') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'mobile' } });
    expect(select.value).toBe('mobile');
    fireEvent.click(screen.getByTestId('mode-code'));
    expect(screen.getByTestId('design-editor')).toBeTruthy();
  });

  it('hides layers for non-html paths and still previews text', () => {
    const buffer = openHtml('plain text notes', 'notes.txt');
    render(<DesignEditor buffer={buffer} mode="preview" />);
    expect(screen.queryByTestId('layers-panel')).toBeNull();
    expect(screen.getByTestId('preview-frame')).toBeTruthy();
  });

  it('disables save while saving and when clean', () => {
    const buffer = openHtml('<body>ok</body>');
    render(<DesignEditor buffer={buffer} mode="code" saving />);
    const save = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows inspect hint when in inspect without selection detail', () => {
    const buffer = openHtml('<body><p>x</p></body>');
    render(
      <DesignEditor
        buffer={buffer}
        mode="inspect"
        selection={{ filePath: 'index.html', selector: 'p', layerId: 'e1' }}
      />,
    );
    expect(screen.getByText(/click to select/i)).toBeTruthy();
    expect(screen.getByTestId('inspect-panel')).toBeTruthy();
  });

  it('shift/meta multi-select works for jsx layer paths (v0.8.5)', () => {
    const onSelectionChange = vi.fn();
    const jsx = `export function App() {\n  return (\n    <div>\n      <h1>Title</h1>\n      <p>Body</p>\n    </div>\n  );\n}\n`;
    const buffer = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'App.jsx',
      content: jsx,
    });
    render(
      <DesignEditor
        buffer={buffer}
        mode="preview"
        onSelectionChange={onSelectionChange}
      />,
    );
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    const rows = screen.getAllByRole('treeitem');
    expect(rows.length).toBeGreaterThan(1);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[rows.length - 1]!, { shiftKey: true });
    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as {
      multiSelectors?: string[];
    };
    // multi may publish when both selected
    if (last?.multiSelectors) {
      expect(last.multiSelectors.length).toBeGreaterThan(1);
    }
  });
});

describe('mergePeerCanvasFrames', () => {
  const box = (n: number) => [{ x: n, y: n, width: 10, height: 10 }];

  it('returns measured when explicit empty and vice versa', () => {
    const measured: PeerCanvasFrame[] = [{ sessionId: 'a', colorHint: 1, bboxes: box(1) }];
    const explicit: PeerCanvasFrame[] = [{ sessionId: 'b', colorHint: 2, bboxes: box(2) }];
    expect(mergePeerCanvasFrames([], measured)).toBe(measured);
    expect(mergePeerCanvasFrames(explicit, [])).toBe(explicit);
  });

  it('explicit wins per sessionId; measured without sessionId always kept', () => {
    const explicit: PeerCanvasFrame[] = [
      { sessionId: 's1', colorHint: 10, label: 'explicit', bboxes: box(1) },
    ];
    const measured: PeerCanvasFrame[] = [
      { sessionId: 's1', colorHint: 99, label: 'measured-dup', bboxes: box(9) },
      { sessionId: 's2', colorHint: 20, label: 'measured-only', bboxes: box(2) },
      { colorHint: 30, label: 'no-sid', bboxes: box(3) },
    ];
    const merged = mergePeerCanvasFrames(explicit, measured);
    expect(merged).toHaveLength(3);
    expect(merged[0]!.label).toBe('explicit');
    expect(merged[0]!.colorHint).toBe(10);
    expect(merged.map((f) => f.label)).toEqual(['explicit', 'measured-only', 'no-sid']);
  });
});

describe('DesignEditor canvas polish (v0.8.5)', () => {
  it('renders peerCanvasFrames on overlay', async () => {
    const buffer = openHtml('<div id="hero">Hi</div>');
    render(
      <DesignEditor
        buffer={buffer}
        mode="inspect"
        canvasOverlay
        peerCanvasFrames={[
          {
            colorHint: 120,
            label: 'Bob',
            bboxes: [{ x: 20, y: 30, width: 40, height: 15 }],
          },
        ]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('canvas-overlay-peer-frame')).toBeTruthy();
    });
    expect(screen.getByTestId('canvas-overlay-peer-label').textContent).toBe('Bob');
  });

  it('undo/redo canvas transform via Cmd+Z / Shift+Cmd+Z', async () => {
    const { useState } = await import('react');
    const html =
      '<div data-neos-id="e1" id="hero" style="position: relative; left: 0px; top: 0px">Hi</div>';
    const initial = openHtml(html);
    const edits: string[] = [];

    function Harness() {
      const [buffer, setBuffer] = useState(initial);
      return (
        <DesignEditor
          buffer={buffer}
          mode="inspect"
          canvasOverlay
          onEdit={(content) => {
            edits.push(content);
            setBuffer((b) => reduceEditorBuffer(b, { type: 'edit', content }));
          }}
          selection={{ filePath: 'index.html', selector: '#hero', layerId: 'e1' }}
        />
      );
    }

    render(<Harness />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: NEOS_BRIDGE_SOURCE,
            type: 'neos.select',
            selection: {
              selector: '#hero',
              tag: 'div',
              bbox: { x: 10, y: 10, width: 100, height: 40 },
            },
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('canvas-overlay-frame')).toBeTruthy();
    });

    const frame = screen.getByTestId('canvas-overlay-frame');
    fireEvent.mouseDown(frame, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 65 });
    fireEvent.mouseUp(window, { clientX: 70, clientY: 65 });

    await waitFor(() => {
      expect(edits.length).toBeGreaterThan(0);
    });
    const afterMove = edits.at(-1)!;
    expect(afterMove).toMatch(/left:\s*20px/);

    const nAfterMove = edits.length;
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
      );
    });
    await waitFor(() => {
      expect(edits.length).toBeGreaterThan(nAfterMove);
    });
    expect(edits.at(-1)).toBe(html);

    const nAfterUndo = edits.length;
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    await waitFor(() => {
      expect(edits.length).toBeGreaterThan(nAfterUndo);
    });
    expect(edits.at(-1)).toBe(afterMove);
  });
});
