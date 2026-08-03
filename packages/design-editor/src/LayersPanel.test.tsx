import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LayersPanel } from './LayersPanel.js';
import type { LayerNode } from '@neos-work/shared';

const layers: LayerNode[] = [
  {
    id: 'body',
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
        name: 'h1.title',
        selector: 'h1.title',
        depth: 1,
        visible: true,
        locked: false,
        children: [],
      },
    ],
  },
];

const deepLayers: LayerNode[] = [
  {
    id: 'root',
    tag: 'div',
    name: 'div.root',
    selector: 'div.root',
    depth: 0,
    visible: true,
    locked: false,
    children: [
      {
        id: 'child',
        tag: 'span',
        name: 'span.child',
        selector: 'span.child',
        depth: 1,
        visible: false,
        locked: true,
        children: [],
      },
    ],
  },
];

describe('LayersPanel', () => {
  it('renders tree, selects row, toggles visibility', () => {
    const onSelect = vi.fn();
    const onVis = vi.fn();
    render(
      <LayersPanel
        layers={layers}
        source="parse"
        onSelect={onSelect}
        onToggleVisibility={onVis}
      />,
    );
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    expect(screen.getByTestId('layers-source').textContent).toMatch(/Parse/i);
    fireEvent.click(screen.getByTestId('layer-row-h1'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'h1' }),
      expect.objectContaining({ additive: false }),
    );
    fireEvent.click(screen.getByTestId('layer-row-h1'), { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'h1' }),
      expect.objectContaining({ additive: true }),
    );
    fireEvent.click(screen.getByTestId('layer-vis-h1'));
    expect(onVis).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }), false);
  });

  it('filters layers by query', () => {
    render(<LayersPanel layers={layers} />);
    fireEvent.change(screen.getByTestId('layers-filter'), {
      target: { value: 'no-match-xyz' },
    });
    expect(screen.getByTestId('layers-empty')).toBeTruthy();
  });

  it('collapses, locks, hovers, context-menu, and footer actions', () => {
    const onHover = vi.fn();
    const onLock = vi.fn();
    const onCopy = vi.fn();
    const onEdit = vi.fn();
    render(
      <LayersPanel
        layers={deepLayers}
        source="bridge"
        selectedLayerId="child"
        onHover={onHover}
        onToggleLock={onLock}
        onCopySelector={onCopy}
        onEditWithAi={onEdit}
      />,
    );
    expect(screen.getByTestId('layers-source').textContent).toMatch(/Live|Bridge/i);

    const root = screen.getByTestId('layer-row-root');
    fireEvent.mouseEnter(root);
    expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ id: 'root' }));
    fireEvent.mouseLeave(root);
    expect(onHover).toHaveBeenCalledWith(null);

    // collapse parent (root is the only collapsible row)
    const rootCollapse = screen
      .getByTestId('layer-row-root')
      .querySelector('button[aria-label="Collapse"]') as HTMLButtonElement;
    fireEvent.click(rootCollapse);
    expect(screen.queryByTestId('layer-row-child')).toBeNull();
    const rootExpand = screen
      .getByTestId('layer-row-root')
      .querySelector('button[aria-label="Expand"]') as HTMLButtonElement;
    fireEvent.click(rootExpand);
    expect(screen.getByTestId('layer-row-child')).toBeTruthy();

    fireEvent.click(screen.getByTestId('layer-lock-child'));
    expect(onLock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'child' }),
      false,
    );

    // context menu: default copy, shift = edit
    fireEvent.contextMenu(screen.getByTestId('layer-row-child'));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }));
    fireEvent.contextMenu(screen.getByTestId('layer-row-child'), { shiftKey: true });
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }));

    fireEvent.click(screen.getByTestId('layers-copy-selector'));
    fireEvent.click(screen.getByTestId('layers-edit-ai'));
    expect(onCopy).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
  });
});
