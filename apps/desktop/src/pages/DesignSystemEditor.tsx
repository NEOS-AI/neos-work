import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignSystem } from '../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';

type EditorTab = 'design' | 'rules' | 'tokens';
type TabBuffer = { content: string; savedContent: string };

const EMPTY_BUF: TabBuffer = { content: '', savedContent: '' };
const TABS: EditorTab[] = ['design', 'rules', 'tokens'];

function dirty(buf: TabBuffer): boolean {
  return buf.content !== buf.savedContent;
}

function isNotFound(res: { ok: boolean; error?: string }): boolean {
  return !res.ok && /not found/i.test(res.error ?? '');
}

function stripNullBytes(raw: string): string {
  return /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
}

export function DesignSystemEditor() {
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const readOnly = searchParams.get('mode') === 'view';
  const { client } = useEngine();
  const navigate = useNavigate();

  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('design');
  const [design, setDesign] = useState<TabBuffer>(EMPTY_BUF);
  const [rules, setRules] = useState<TabBuffer>(EMPTY_BUF);
  const [tokens, setTokens] = useState<TabBuffer>(EMPTY_BUF);
  const [rulesMissing, setRulesMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveKind, setSaveKind] = useState<'ok' | 'err' | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bundled = ds?.source === 'bundled';
  const anyDirty = !readOnly && (dirty(design) || dirty(rules) || dirty(tokens));
  const activeBuf = activeTab === 'design' ? design : activeTab === 'rules' ? rules : tokens;
  const activeDirty = !readOnly && dirty(activeBuf);
  const tabLocked = Boolean(bundled && activeTab !== 'design');
  const textareaReadOnly = readOnly || tabLocked;

  const load = useCallback(async () => {
    if (!client || !id) return;
    // Do not re-enter full-page loading after first paint — parent re-renders
    // (new client object identity) must not unmount the editor mid-edit.
    setLoadError(null);
    // Control-char / blank / overlong route ids never sent to content API
    const safeId = safeEntityId(id);
    if (!safeId) {
      setDs(null);
      setLoadError(t('designSystems.invalidId'));
      setLoading(false);
      return;
    }
    try {
      const [dsRes, contentRes, rulesRes, tokensRes] = await Promise.all([
        client.listDesignSystems(),
        client.getDesignSystemContent(safeId),
        client.getDesignSystemRules(safeId),
        client.getDesignSystemTokens(safeId),
      ]);
      if (!dsRes.ok) {
        setDs(null);
        setLoadError(
          scrubDisplayText((dsRes as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('designSystems.loadFailed'),
        );
        return;
      }
      const found = (dsRes.data ?? []).find((d) => d.id === id || d.id === safeId) ?? null;
      if (!found) {
        setDs(null);
        setLoadError(t('designSystems.notFound'));
        return;
      }
      setDs(found);
      if (contentRes.ok && contentRes.data) {
        const raw = typeof contentRes.data.content === 'string' ? contentRes.data.content : '';
        const safe = stripNullBytes(raw);
        setDesign({ content: safe, savedContent: safe });
      } else {
        setDesign(EMPTY_BUF);
        setLoadError(
          scrubDisplayText((contentRes as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('designSystems.loadContentFailed'),
        );
      }

      if (rulesRes.ok && rulesRes.data) {
        const raw = typeof rulesRes.data.content === 'string' ? rulesRes.data.content : '';
        const safe = stripNullBytes(raw);
        setRules({ content: safe, savedContent: safe });
        setRulesMissing(false);
      } else if (isNotFound(rulesRes)) {
        const placeholder = t('designSystems.rulesPlaceholder');
        setRules({ content: placeholder, savedContent: placeholder });
        setRulesMissing(true);
      } else {
        setRules(EMPTY_BUF);
        setRulesMissing(false);
        if (contentRes.ok) {
          setLoadError(
            scrubDisplayText((rulesRes as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || t('designSystems.loadFailedGeneric'),
          );
        }
      }

      if (tokensRes.ok && tokensRes.data) {
        const raw = typeof tokensRes.data.content === 'string' ? tokensRes.data.content : '';
        const safe = stripNullBytes(raw);
        setTokens({ content: safe, savedContent: safe });
      } else {
        setTokens(EMPTY_BUF);
      }
    } catch (err) {
      setDs(null);
      const msg = err instanceof Error ? err.message : t('designSystems.loadFailedGeneric');
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || t('designSystems.loadFailedGeneric'),
      );
    } finally {
      setLoading(false);
    }
  }, [client, id, t]);

  useEffect(() => { void load(); }, [load]);

  const setActiveContent = useCallback((value: string) => {
    if (readOnly || tabLocked) return;
    const patch = (buf: TabBuffer): TabBuffer => ({ ...buf, content: value });
    if (activeTab === 'design') setDesign(patch);
    else if (activeTab === 'rules') setRules(patch);
    else setTokens(patch);
  }, [activeTab, readOnly, tabLocked]);

  const handleSave = useCallback(async () => {
    if (readOnly || !client || !id || saving) return;
    const safeId = safeEntityId(id);
    if (!safeId) {
      setSaveKind('err');
      setSaveMessage(t('designSystems.invalidIdSave'));
      return;
    }
    if (bundled && (activeTab === 'rules' || activeTab === 'tokens')) {
      const detail = 'Bundled design systems are read-only';
      setSaveKind('err');
      setSaveMessage(
        t(
          activeTab === 'rules' ? 'designSystems.rulesSaveFailed' : 'designSystems.tokensSaveFailed',
          { detail },
        ),
      );
      return;
    }
    if (!activeDirty) return;
    const content = activeBuf.content;
    const failKey =
      activeTab === 'rules'
        ? 'designSystems.rulesSaveFailed'
        : activeTab === 'tokens'
          ? 'designSystems.tokensSaveFailed'
          : 'designSystems.saveFailed';
    if (/\0/.test(content)) {
      setSaveKind('err');
      setSaveMessage(t('designSystems.invalidContent'));
      return;
    }
    if (!content.trim()) {
      setSaveKind('err');
      setSaveMessage(t('designSystems.emptyContent'));
      return;
    }
    setSaving(true);
    setSaveKind(null);
    setSaveMessage(null);
    try {
      const res =
        activeTab === 'rules'
          ? await client.saveDesignSystemRules(safeId, content)
          : activeTab === 'tokens'
            ? await client.saveDesignSystemTokens(safeId, content)
            : await client.saveDesignSystemContent(safeId, content);
      if (res.ok) {
        const saved = (buf: TabBuffer): TabBuffer => ({ ...buf, savedContent: buf.content });
        if (activeTab === 'design') setDesign(saved);
        else if (activeTab === 'rules') {
          setRules(saved);
          setRulesMissing(false);
        } else setTokens(saved);
        setSaveKind('ok');
        setSaveMessage(t('designSystems.saved'));
      } else {
        const detail =
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 }) || 'unknown';
        setSaveKind('err');
        setSaveMessage(t(failKey, { detail }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      const detail =
        scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || 'unknown';
      setSaveKind('err');
      setSaveMessage(t(failKey, { detail }));
    } finally {
      setSaving(false);
    }
  }, [
    client,
    id,
    saving,
    t,
    readOnly,
    bundled,
    activeTab,
    activeDirty,
    activeBuf.content,
  ]);

  // Clear save toast after a short delay (and on unmount)
  useEffect(() => {
    if (!saveMessage) return;
    const t = window.setTimeout(() => {
      setSaveMessage(null);
      setSaveKind(null);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [saveMessage]);

  const handleBack = useCallback(() => {
    if (anyDirty && !window.confirm(t('designSystems.unsavedLeave'))) return;
    navigate('/design-systems');
  }, [anyDirty, navigate, t]);

  const handleStartEdit = useCallback(() => {
    if (!id) return;
    const safeId = safeEntityId(id);
    if (!safeId) return;
    navigate(`/design-systems/${safeId}`);
  }, [id, navigate]);

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

  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

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

  if (loading) {
    return (
      <div className="p-6 text-white/40 text-sm">{t('common.loading')}</div>
    );
  }

  if (!ds) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 })
            || t('designSystems.notFound')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/design-systems')}
          className="self-start text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          {t('designSystems.back')}
        </button>
      </div>
    );
  }

  const hintKey = readOnly
    ? 'designSystems.viewHint'
    : activeTab === 'rules'
      ? 'designSystems.rulesHint'
      : 'designSystems.hint';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-white/40 hover:text-white/70 text-sm transition-colors"
          >
            {t('designSystems.back')}
          </button>
          <span className="text-white/20">/</span>
          <span className="text-white font-medium text-sm">
            {scrubDisplayText(ds.name, { collapseLines: true, maxChars: 200 })
              || t('designSystems.fallbackName')}
          </span>
          {readOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">
              {t('designSystems.readOnly')}
            </span>
          )}
          {anyDirty && <span className="text-xs text-amber-400">●</span>}
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && !readOnly && (
            <span className={`text-xs ${saveKind === 'err' ? 'text-red-400' : 'text-emerald-400'}`}>
              {scrubDisplayText(saveMessage, { collapseLines: true, maxChars: 200 })}
            </span>
          )}
          {readOnly ? (
            <button
              type="button"
              onClick={handleStartEdit}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors"
            >
              {t('designSystems.startEdit')}
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving || !activeDirty || tabLocked}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm transition-colors"
            >
              {saving ? t('designSystems.saving') : t('common.save')}
            </button>
          )}
        </div>
      </div>
      {loadError && (
        <div className="px-6 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-400 shrink-0">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </div>
      )}

      <div
        role="tablist"
        aria-label={`${t('designSystems.tab.design')} ${t('designSystems.tab.rules')} ${t('designSystems.tab.tokens')}`}
        className="flex items-center gap-1 px-6 pt-2 border-b border-white/5 shrink-0"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            data-testid={`ds-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs rounded-t-md transition-colors ${
              activeTab === tab
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t(`designSystems.tab.${tab}`)}
          </button>
        ))}
      </div>

      {/* Hint */}
      <div className="px-6 py-2 bg-white/[0.02] border-b border-white/5 text-xs text-white/30 shrink-0">
        {t(hintKey)}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 p-4">
        <textarea
          ref={textareaRef}
          value={activeBuf.content}
          readOnly={textareaReadOnly}
          aria-readonly={textareaReadOnly}
          onChange={(e) => setActiveContent(e.target.value)}
          spellCheck={false}
          className={`w-full h-full resize-none bg-transparent text-sm font-mono text-white/80 focus:outline-none leading-relaxed ${
            textareaReadOnly ? 'cursor-default' : ''
          }`}
          placeholder={textareaReadOnly ? undefined : t('designSystems.editorPlaceholder')}
        />
      </div>
    </div>
  );
}
