/**
 * Web Design System editor — DESIGN.md + RULES.md (thin; English hardcoded).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, type ApiEnvelope, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type EditorTab = 'design' | 'rules';
type TabBuffer = { content: string; savedContent: string };

const EMPTY_BUF: TabBuffer = { content: '', savedContent: '' };

const RULES_PLACEHOLDER = `# Agent rules

This file is the behavioral half of the design harness.
Visual tokens live in DESIGN.md and tokens.css. Do not duplicate palettes here.

## Tools
- Prefer editing the open project HTML/CSS. Do not start from an empty document when a seed file exists.
- Use Design Editor selection / preview comments when present.
- Produce self-contained, clickable HTML (hover, focus, scroll, transitions). Not a screenshot mock.

## Never
- Do not invent a new color palette or font stack when tokens.css defines one.
- Do not use raw hex/rgb for brand colors; use CSS custom properties from tokens.css.
- Do not ship inaccessible contrast or missing focus rings.
- Do not overwrite unrelated manual edits (prefer a minimal patch).

## Preferred workflow
- Start from the seed (current file, components.html, or a starter), generate a few variants as sibling files, then narrow to one.
- After a human correction, wait for an explicit promote; do not rewrite RULES.md yourself unless asked.

## Corrections
<!-- dated bullets, pruned when stale. format: - YYYY-MM-DD: text -->`;

function dirty(buf: TabBuffer): boolean {
  return buf.content !== buf.savedContent;
}

function stripNullBytes(raw: string): string {
  return /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
}

function isRulesNotFound(outcome: unknown): boolean {
  if (outcome instanceof ApiError && outcome.status === 404) return true;
  if (outcome && typeof outcome === 'object' && 'ok' in outcome) {
    const env = outcome as ApiEnvelope;
    return env.ok === false && /not found/i.test(env.error ?? '');
  }
  return false;
}

export function DesignSystemEditor() {
  const { id: routeId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const id =
    typeof routeId === 'string' && routeId.trim() && !/[\0\r\n]/.test(routeId) ? routeId.trim() : '';
  const [name, setName] = useState(id);
  const [activeTab, setActiveTab] = useState<EditorTab>('design');
  const [design, setDesign] = useState<TabBuffer>(EMPTY_BUF);
  const [rules, setRules] = useState<TabBuffer>(EMPTY_BUF);
  const [rulesMissing, setRulesMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeBuf = activeTab === 'design' ? design : rules;
  const activeDirty = dirty(activeBuf);
  const anyDirty = dirty(design) || dirty(rules);

  const load = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    if (!id) {
      setError('Invalid design system id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [list, body, rulesOutcome] = await Promise.all([
        client.listDesignSystems(),
        client.getDesignSystemContent(id),
        client.getDesignSystemRules(id).then(
          (r) => r,
          (err: unknown) => err,
        ),
      ]);
      const found = (list.data ?? []).find((d) => d.id === id);
      setName(found?.name || id);
      const raw = typeof body.data?.content === 'string' ? body.data.content : '';
      const safe = stripNullBytes(raw);
      setDesign({ content: safe, savedContent: safe });
      if (!body.ok) setError(scrubError(body.error, 'Failed to load content'));

      if (isRulesNotFound(rulesOutcome)) {
        setRules({ content: RULES_PLACEHOLDER, savedContent: RULES_PLACEHOLDER });
        setRulesMissing(true);
      } else if (rulesOutcome instanceof Error) {
        setRules(EMPTY_BUF);
        setRulesMissing(false);
        if (body.ok) setError(scrubError(rulesOutcome, 'Failed to load'));
      } else {
        const env = rulesOutcome as ApiEnvelope<{ content: string }>;
        if (env.ok) {
          const rulesRaw = typeof env.data?.content === 'string' ? env.data.content : '';
          const rulesSafe = stripNullBytes(rulesRaw);
          setRules({ content: rulesSafe, savedContent: rulesSafe });
          setRulesMissing(false);
        } else {
          setRules(EMPTY_BUF);
          setRulesMissing(false);
          if (body.ok) setError(scrubError(env.error, 'Failed to load'));
        }
      }
    } catch (err) {
      setError(scrubError(err, 'Failed to load'));
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, id, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  const handleSave = async () => {
    if (!id || saving || !activeDirty) return;
    if (activeTab === 'rules' && rulesMissing && !dirty(rules)) return;
    if (/\0/.test(activeBuf.content)) {
      setError(scrubError('Invalid content', 'Save failed'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res =
        activeTab === 'rules'
          ? await client.saveDesignSystemRules(id, activeBuf.content)
          : await client.saveDesignSystemContent(id, activeBuf.content);
      if (!res.ok) {
        setError(scrubError(res.error, 'Save failed'));
        return;
      }
      if (activeTab === 'rules') {
        setRules({ content: activeBuf.content, savedContent: activeBuf.content });
        setRulesMissing(false);
      } else {
        setDesign({ content: activeBuf.content, savedContent: activeBuf.content });
      }
    } catch (err) {
      setError(scrubError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="layout stack" data-testid="ds-editor">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <button type="button" className="btn btn-ghost" data-testid="ds-editor-back" onClick={() => nav('/design-systems')}>
            ← Design systems
          </button>
          <h1 style={{ margin: 0, fontSize: '1.1rem' }}>{name}</h1>
          {anyDirty && <span className="muted">Unsaved</span>}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            data-testid="ds-editor-save"
            disabled={saving || !activeDirty}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <WebNav current="/design-systems" />
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div role="tablist" className="row" style={{ gap: 4 }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'design'}
              data-testid="ds-tab-design"
              className="btn btn-ghost"
              onClick={() => setActiveTab('design')}
            >
              DESIGN.md
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rules'}
              data-testid="ds-tab-rules"
              className="btn btn-ghost"
              onClick={() => setActiveTab('rules')}
            >
              RULES.md
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            DESIGN.md is visual guidance. Use the RULES.md tab for agent behavior.
          </p>
          <textarea
            className="input"
            data-testid="ds-editor-content"
            value={activeBuf.content}
            onChange={(e) => {
              const value = e.target.value;
              if (activeTab === 'design') setDesign((buf) => ({ ...buf, content: value }));
              else setRules((buf) => ({ ...buf, content: value }));
            }}
            rows={24}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </>
      )}
    </div>
  );
}
