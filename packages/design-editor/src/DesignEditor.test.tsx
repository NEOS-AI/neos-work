import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignEditor } from './DesignEditor.js';
import { createEmptyBuffer, reduceEditorBuffer } from './dirty-state.js';

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

describe('DesignEditor chrome', () => {
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
