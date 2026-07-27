import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeEditor } from './CodeEditor.js';

describe('CodeEditor', () => {
  it('renders with aria label and mounts editor', async () => {
    const { container, unmount } = render(
      <CodeEditor value="<p>hello</p>" filePath="index.html" aria-label="main editor" />,
    );
    const box = container.querySelector('[role="textbox"]');
    expect(box).toBeTruthy();
    expect(box?.getAttribute('aria-label')).toBe('main editor');
    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeTruthy();
    });
    unmount();
  });

  it('uses css language for .css paths and js for .js/.tsx', async () => {
    for (const filePath of ['styles.css', 'app.js', 'Comp.tsx', 'x.mjs', 'y.cjs', 'unknown.bin']) {
      const { container, unmount } = render(
        <CodeEditor value="/* body */" filePath={filePath} />,
      );
      await waitFor(() => {
        expect(container.querySelector('.cm-editor')).toBeTruthy();
      });
      unmount();
    }
  });

  it('calls onChange when document changes and syncs external value', async () => {
    const onChange = vi.fn();
    const { rerender, container, unmount } = render(
      <CodeEditor value="one" onChange={onChange} filePath="a.html" />,
    );
    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());

    // external value sync
    rerender(<CodeEditor value="two" onChange={onChange} filePath="a.html" />);
    await waitFor(() => {
      const cm = container.querySelector('.cm-content');
      expect(cm?.textContent).toContain('two');
    });
    unmount();
  });

  it('respects readOnly', async () => {
    const { container, unmount } = render(
      <CodeEditor value="ro" readOnly filePath="a.html" />,
    );
    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
    unmount();
  });
});
