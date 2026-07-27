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
});
