/**
 * RunLogPanel — live run log with streaming progress (PLAN Task 14).
 * Collapsed consecutive node.progress rows; expandable accumulated text.
 * Linkifies http(s) URLs in outputs (deploy links, media paths).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowSSEEvent } from '../../lib/engine.js';
import { formatDurationMs } from '../../lib/format-duration.js';
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

/** Exported for unit tests — turn plain text into linkified React nodes. */
export function linkifyText(text: string): ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      const href = part.replace(/[.,;:)]+$/, '');
      const trailing = part.slice(href.length);
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

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function RunLogPanel({ events, nodeLabelMap }: RunLogPanelProps) {
  const { t } = useTranslation('common');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState<RunLogFilter>(() => loadRunLogFilter());
  const endRef = useRef<HTMLDivElement | null>(null);

  const handleLogFilter = (next: RunLogFilter) => {
    setLogFilter(next);
    saveRunLogFilter(next);
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
        const nodeLabel = 'nodeId' in ev
          ? (nodeLabelMap[(ev as { nodeId: string }).nodeId] ?? (ev as { nodeId: string }).nodeId)
          : null;
        const isExpanded = expandedIdx === i;
        const hasOutput = ev.type === 'node.completed' && (ev as { output?: unknown }).output !== undefined;
        const isProgress = ev.type === 'node.progress';
        const isLast = i === visibleEvents.length - 1;
        const durationMs = ev.type === 'node.completed'
          ? (ev as { durationMs?: number }).durationMs
          : undefined;
        const artifactId = ev.type === 'run.completed'
          ? (ev as { artifactId?: string }).artifactId
          : undefined;
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
            {ev.type === 'node.started' && `▶ ${nodeLabel} (${(ev as { nodeType: string }).nodeType})`}
            {ev.type === 'node.progress' && (
              <span className="text-sky-400">
                … {nodeLabel} streaming{(ev as { accumulated?: string }).accumulated ? ' ▸' : ''}
              </span>
            )}
            {ev.type === 'node.completed' && (
              <span>
                ✓ {nodeLabel}
                {durationMs !== undefined ? ` · ${formatDurationMs(durationMs)}` : ''}
                {hasOutput ? ' ▸' : ''}
              </span>
            )}
            {ev.type === 'node.failed' && `✗ ${nodeLabel}: ${(ev as { error: string }).error}`}
            {ev.type === 'run.started' && `Run ${(ev as { runId: string }).runId.slice(0, 8)}`}
            {ev.type === 'run.completed' && (
              <span>
                {t('workflow.done')} ({(ev as { duration: number }).duration}ms)
                {artifactId ? ` · artifact ${artifactId.slice(0, 8)}` : ''}
              </span>
            )}
            {ev.type === 'run.failed' && (ev as { error: string }).error}
            {isExpanded && isProgress && (
              <div className="mt-1">
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    className="text-[10px] underline"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = ((ev as { accumulated?: string; chunk?: string }).accumulated
                        ?? (ev as { chunk?: string }).chunk
                        ?? '');
                      void navigator.clipboard?.writeText(text);
                    }}
                  >
                    Copy
                  </button>
                </div>
                <pre
                  className="max-h-40 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                >
                  {((ev as { accumulated?: string; chunk?: string }).accumulated
                    ?? (ev as { chunk?: string }).chunk
                    ?? '').slice(-2000)}
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
                      void navigator.clipboard?.writeText(
                        formatOutput((ev as { output: unknown }).output),
                      );
                    }}
                  >
                    Copy
                  </button>
                </div>
                <pre
                  className="max-h-48 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                >
                  {linkifyText(formatOutput((ev as { output: unknown }).output).slice(0, 2000))}
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
