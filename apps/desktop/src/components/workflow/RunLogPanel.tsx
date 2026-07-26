/**
 * RunLogPanel — live run log with streaming progress (PLAN Task 14).
 * Collapsed consecutive node.progress rows; expandable accumulated text.
 * Linkifies http(s) URLs in outputs (deploy links, media paths).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowSSEEvent } from '../../lib/engine.js';
import {
  formatDurationMs,
  scrubDisplayText,
  serializeNodeOutput,
} from '../../lib/format-duration.js';
import {
  loadRunLogFilter,
  saveRunLogFilter,
  type RunLogFilterPref,
} from '../../lib/run-log-prefs.js';

interface RunLogPanelProps {
  events: WorkflowSSEEvent[];
  nodeLabelMap: Record<string, string>;
}

type RunLogFilter = RunLogFilterPref;

const URL_RE = /(https?:\/\/[^\s"'<>]+)/g;

const FILTER_LABELS: Record<RunLogFilter, string> = {
  all: 'All',
  lifecycle: 'Lifecycle',
  progress: 'Progress',
  completed: 'Completed',
  failed: 'Failed',
};

/** Exported for unit tests — filter run log events by category chip. */
export function filterRunLogEvents(
  events: WorkflowSSEEvent[],
  filter: RunLogFilter,
): WorkflowSSEEvent[] {
  if (filter === 'all') return events;
  return events.filter((ev) => {
    if (filter === 'progress') return ev.type === 'node.progress';
    if (filter === 'completed') return ev.type === 'node.completed';
    if (filter === 'failed') return ev.type === 'node.failed' || ev.type === 'run.failed';
    if (filter === 'lifecycle') {
      return (
        ev.type === 'run.started'
        || ev.type === 'run.completed'
        || ev.type === 'run.failed'
        || ev.type === 'node.started'
        || ev.type === 'node.failed'
      );
    }
    return true;
  });
}

/**
 * Validate linkify hrefs: http(s) only, no control/whitespace, length-capped.
 * Exported for unit tests.
 */
export function safeLogHref(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  if (/\s/.test(raw)) return '';
  const href = raw.replace(/[.,;:)]+$/, '');
  if (!href || href.length > 2_048) return '';
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return href;
  } catch {
    return '';
  }
}

/** Exported for unit tests — turn plain text into linkified React nodes. */
export function linkifyText(text: string): ReactNode[] {
  // Scrub null bytes before splitting / rendering (keep multi-line for outputs)
  const safe = scrubDisplayText(text);
  const parts = safe.split(URL_RE);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      const href = safeLogHref(part);
      if (!href) {
        // Hostile / overlong / control URL → plain text only
        return <span key={i}>{scrubDisplayText(part, { collapseLines: true, maxChars: 500 })}</span>;
      }
      const trailing = part.startsWith(href) ? part.slice(href.length) : '';
      return (
        <span key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-sky-400"
            onClick={(e) => e.stopPropagation()}
          >
            {href}
          </a>
          {trailing}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** Safe single-line label/error for log rows (control collapsed). */
function safeLogLine(raw: unknown, fallback = ''): string {
  const s = scrubDisplayText(raw, { collapseLines: true, maxChars: 2_000 });
  return s || fallback;
}

export function RunLogPanel({ events, nodeLabelMap }: RunLogPanelProps) {
  const { t } = useTranslation('common');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState<RunLogFilter>(() => loadRunLogFilter());
  /** `${idx}:ok` | `${idx}:fail` for copy button feedback */
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const handleLogFilter = (next: RunLogFilter) => {
    setLogFilter(next);
    saveRunLogFilter(next);
  };

  const copyLogText = async (idx: number, text: string) => {
    try {
      const write = navigator.clipboard?.writeText;
      if (typeof write !== 'function') throw new Error('Clipboard unavailable');
      // Scrub before clipboard (null-byte / control-char defense)
      const safe = scrubDisplayText(text, { maxChars: 100_000 });
      await write.call(navigator.clipboard, safe);
      setCopyStatus(`${idx}:ok`);
      setTimeout(() => setCopyStatus((cur) => (cur === `${idx}:ok` ? null : cur)), 1500);
    } catch {
      setCopyStatus(`${idx}:fail`);
      setTimeout(() => setCopyStatus((cur) => (cur === `${idx}:fail` ? null : cur)), 2000);
    }
  };

  const visibleEvents = useMemo(
    () => filterRunLogEvents(events, logFilter),
    [events, logFilter],
  );

  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [visibleEvents]);

  if (events.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('workflow.noRuns', 'No runs yet')}
      </div>
    );
  }

  // Chip order: lifecycle before progress for scanability during live runs
  const FILTERS = (['all', 'lifecycle', 'progress', 'completed', 'failed'] as const).map((id) => ({
    id,
    label: FILTER_LABELS[id],
  }));

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex flex-wrap gap-1 border-b px-2 py-1.5" style={{ borderColor: 'var(--border-primary)' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => handleLogFilter(f.id)}
            className="rounded px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: logFilter === f.id ? 'var(--bg-accent, #3b82f6)' : 'var(--bg-tertiary)',
              color: logFilter === f.id ? '#fff' : 'var(--text-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="self-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {visibleEvents.length}/{events.length}
        </span>
      </div>
    <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
      {visibleEvents.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No events match this filter.</p>
      ) : null}
      {visibleEvents.map((ev, i) => {
        const rawNodeId =
          'nodeId' in ev ? String((ev as { nodeId: string }).nodeId ?? '') : '';
        // Control-char node ids / labels collapsed for safe single-line display
        const nodeLabel = 'nodeId' in ev
          ? safeLogLine(
              nodeLabelMap[rawNodeId] ?? rawNodeId,
              safeLogLine(rawNodeId, 'node'),
            )
          : null;
        const isExpanded = expandedIdx === i;
        const hasOutput = ev.type === 'node.completed' && (ev as { output?: unknown }).output !== undefined;
        const isProgress = ev.type === 'node.progress';
        const isLast = i === visibleEvents.length - 1;
        const durationMs = ev.type === 'node.completed'
          ? (ev as { durationMs?: number }).durationMs
          : undefined;
        const artifactIdRaw = ev.type === 'run.completed'
          ? (ev as { artifactId?: string }).artifactId
          : undefined;
        const artifactId =
          typeof artifactIdRaw === 'string' && !/[\0\r\n]/.test(artifactIdRaw)
            ? artifactIdRaw.trim()
            : undefined;
        const streamText = scrubDisplayText(
          (ev as { accumulated?: string; chunk?: string }).accumulated
            ?? (ev as { chunk?: string }).chunk
            ?? '',
          { maxChars: 100_000 },
        );
        const nodeTypeSafe =
          ev.type === 'node.started'
            ? safeLogLine((ev as { nodeType?: string }).nodeType, 'node')
            : '';
        const failedError =
          ev.type === 'node.failed' || ev.type === 'run.failed'
            ? safeLogLine((ev as { error?: string }).error, 'error')
            : '';
        const runIdSafe =
          ev.type === 'run.started' || ev.type === 'run.completed' || ev.type === 'run.failed'
            ? safeLogLine((ev as { runId?: string }).runId, 'run')
            : '';
        return (
          <div
            key={i}
            ref={isLast ? endRef : undefined}
            className={`rounded px-2 py-1${hasOutput || isProgress ? ' cursor-pointer' : ''}`}
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={() => {
              if (hasOutput || isProgress) setExpandedIdx(isExpanded ? null : i);
            }}
          >
            {ev.type === 'node.started' && `▶ ${nodeLabel} (${nodeTypeSafe})`}
            {ev.type === 'node.progress' && (
              <span className="text-sky-400">
                … {nodeLabel} streaming{streamText ? ' ▸' : ''}
              </span>
            )}
            {ev.type === 'node.completed' && (
              <span>
                ✓ {nodeLabel}
                {durationMs !== undefined ? ` · ${formatDurationMs(durationMs)}` : ''}
                {hasOutput ? ' ▸' : ''}
              </span>
            )}
            {ev.type === 'node.failed' && `✗ ${nodeLabel}: ${failedError}`}
            {ev.type === 'run.started' && `Run ${runIdSafe.slice(0, 8)}`}
            {ev.type === 'run.completed' && (
              <span>
                {t('workflow.done')} ({(ev as { duration: number }).duration}ms)
                {artifactId ? ` · artifact ${artifactId.slice(0, 8)}` : ''}
              </span>
            )}
            {ev.type === 'run.failed' && failedError}
            {isExpanded && isProgress && (
              <div className="mt-1">
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    className="text-[10px] underline"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyLogText(i, streamText);
                    }}
                  >
                    {copyStatus === `${i}:ok`
                      ? 'Copied'
                      : copyStatus === `${i}:fail`
                        ? 'Copy failed'
                        : 'Copy'}
                  </button>
                </div>
                <pre
                  className="max-h-40 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                >
                  {streamText.slice(-2000)}
                </pre>
              </div>
            )}
            {isExpanded && hasOutput && (
              <div className="mt-1">
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    className="text-[10px] underline"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyLogText(
                        i,
                        serializeNodeOutput((ev as { output: unknown }).output),
                      );
                    }}
                  >
                    {copyStatus === `${i}:ok`
                      ? 'Copied'
                      : copyStatus === `${i}:fail`
                        ? 'Copy failed'
                        : 'Copy'}
                  </button>
                </div>
                <pre
                  className="max-h-48 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                >
                  {linkifyText(
                    serializeNodeOutput((ev as { output: unknown }).output, 2_000),
                  )}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
