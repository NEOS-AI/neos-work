import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignSystem } from '../lib/engine.js';

export function DesignSystemEditor() {
  const { id } = useParams<{ id: string }>();
  const { client } = useEngine();
  const navigate = useNavigate();

  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== savedContent;

  const load = useCallback(async () => {
    if (!client || !id) return;
    const [dsRes, contentRes] = await Promise.all([
      client.listDesignSystems(),
      client.getDesignSystemContent(id),
    ]);
    if (dsRes.ok && dsRes.data) {
      const found = dsRes.data.find((d) => d.id === id);
      setDs(found ?? null);
    }
    if (contentRes.ok && contentRes.data) {
      setContent(contentRes.data.content);
      setSavedContent(contentRes.data.content);
    }
  }, [client, id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async () => {
    if (!client || !id || saving) return;
    setSaving(true);
    setSaveMessage(null);
    const res = await client.saveDesignSystemContent(id, content);
    if (res.ok) {
      setSavedContent(content);
      setSaveMessage('Saved');
    } else {
      setSaveMessage('Save failed: ' + (res.error ?? 'unknown'));
    }
    setSaving(false);
  }, [client, id, content, saving]);

  // Clear save toast after a short delay (and on unmount)
  useEffect(() => {
    if (!saveMessage) return;
    const t = window.setTimeout(() => setSaveMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [saveMessage]);

  const handleBack = useCallback(() => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate('/design-systems');
  }, [isDirty, navigate]);

  // Cmd+S / Ctrl+S to save (stable deps — do not rebind every render)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Warn on tab close / refresh when DESIGN.md is dirty
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Escape returns to list (confirms when dirty via handleBack).
  // Ignore when a nested dialog already handled Escape, or while still loading.
  useEffect(() => {
    if (!ds) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      handleBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack, ds]);

  if (!ds) {
    return (
      <div className="p-6 text-white/40 text-sm">Loading...</div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            ← Design Systems
          </button>
          <span className="text-white/20">/</span>
          <span className="text-white font-medium text-sm">{ds.name}</span>
          {isDirty && <span className="text-xs text-amber-400">●</span>}
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className={`text-xs ${saveMessage.startsWith('Save failed') ? 'text-red-400' : 'text-emerald-400'}`}>
              {saveMessage}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Hint */}
      <div className="px-6 py-2 bg-white/[0.02] border-b border-white/5 text-xs text-white/30 shrink-0">
        Editing <code className="text-white/50">DESIGN.md</code> — this content will be injected as design context into agent system prompts when this design system is selected in a workflow.
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 p-4">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="w-full h-full resize-none bg-transparent text-sm font-mono text-white/80 focus:outline-none leading-relaxed"
          placeholder="# My Design System&#10;&#10;Describe your brand guidelines, colors, typography, and component styles here..."
        />
      </div>
    </div>
  );
}
