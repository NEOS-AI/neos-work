/**
 * RunLogPanel — live run log with streaming progress (PLAN Task 14).
 * Collapsed consecutive node.progress rows; expandable accumulated text.
 * Linkifies http(s) URLs in outputs (deploy links, media paths).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowSSEEvent } from '../../lib/engine.js';

interface RunLogPanelProps {
  events: WorkflowSSEEvent[];
  nodeLabelMap: Record<string, string>;
}

const URL_RE = /(https?:\/\/[^\s"'<>]+)/g;

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

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function RunLogPanel({ events, nodeLabelMap }: RunLogPanelProps) {
  const { t } = useTranslation('common');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('workflow.noRuns', 'No runs yet')}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
      {events.map((ev, i) => {
        const nodeLabel = 'nodeId' in ev
          ? (nodeLabelMap[(ev as { nodeId: string }).nodeId] ?? (ev as { nodeId: string }).nodeId)
          : null;
        const isExpanded = expandedIdx === i;
        const hasOutput = ev.type === 'node.completed' && (ev as { output?: unknown }).output !== undefined;
        const isProgress = ev.type === 'node.progress';
        const isLast = i === events.length - 1;
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
                {durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : ''}
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
              <pre
                className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              >
                {((ev as { accumulated?: string; chunk?: string }).accumulated
                  ?? (ev as { chunk?: string }).chunk
                  ?? '').slice(-2000)}
              </pre>
            )}
            {isExpanded && hasOutput && (
              <pre
                className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded p-1 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              >
                {linkifyText(formatOutput((ev as { output: unknown }).output).slice(0, 2000))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
