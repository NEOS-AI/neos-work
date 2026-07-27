/**
 * CodeMirror 6 editor pane (Q9 LOCKED — Monaco not default).
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Project-relative path for language heuristics. */
  filePath?: string | null;
  readOnly?: boolean;
  onSave?: () => void;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

function languageExtension(filePath?: string | null) {
  const p = (filePath ?? '').toLowerCase();
  if (p.endsWith('.css')) return css();
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return javascript();
  if (p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) {
    return javascript({ jsx: true, typescript: p.endsWith('.ts') || p.endsWith('.tsx') });
  }
  // default HTML (also fine for .html / unknown design files)
  return html();
}

export function CodeEditor({
  value,
  onChange,
  filePath,
  readOnly = false,
  onSave,
  className,
  style,
  'aria-label': ariaLabel = 'code editor',
}: CodeEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Create editor once
  useEffect(() => {
    if (!parentRef.current) return;

    const saveKey = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        saveKey,
        languageExtension(filePath),
        updateListener,
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '&.cm-focused': { outline: 'none' },
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: parentRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate when language/path/readOnly changes
  }, [filePath, readOnly]);

  // Sync external value when it changes without local edit (open file / take-agent)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ minHeight: 0, flex: 1, height: '100%', overflow: 'hidden', ...style }}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
    />
  );
}
