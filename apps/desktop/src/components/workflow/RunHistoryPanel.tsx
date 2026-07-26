import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowRun } from '../../lib/engine.js';
import { formatDuration, safeEntityId, scrubDisplayText } from '../../lib/format-duration.js';
import { formatListCount } from '../../lib/list-count.js';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/format-relative-time.js';
import {
  filterRunsByStatus,
  loadRunStatusFilter,
  normalizeRunStatus,
  RUN_STATUS_FILTERS,
  saveRunStatusFilter,
  type RunStatusFilter,
} from '../../lib/run-history-filter.js';
import { RunDetailPanel } from './RunDetailPanel.js';

type RunFilter = RunStatusFilter;

const PAGE_SIZE = 20;

const FILTER_LABEL_KEYS: Record<RunStatusFilter, [string, string]> = {
  all: ['run.filterAll', 'All'],
  running: ['run.filterRunning', 'Running'],
  completed: ['run.filterCompleted', 'Completed'],
  failed: ['run.filterFailed', 'Failed'],
  cancelled: ['run.filterCancelled', 'Cancelled'],
};

export function RunHistoryPanel(props: { workflowId: string; refreshKey: number; nodeLabelMap?: Record<string, string> }) {
  const { client } = useEngine();
  const { t } = useTranslation('common');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilter>(() => loadRunStatusFilter());
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleFilter = (next: RunFilter) => {
    setFilter(next);
    saveRunStatusFilter(next);
  };

  useEffect(() => {
    setOffset(0);
    setRuns([]);
    setLoadError(null);
  }, [props.workflowId, props.refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client
      .listWorkflowRuns(props.workflowId, PAGE_SIZE + 1, offset)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setLoadError(null);
          const fetched = res.data;
          const hasMoreData = fetched.length > PAGE_SIZE;
          const page = fetched.slice(0, PAGE_SIZE);
          setRuns((prev) => {
            if (offset === 0) return page;
            // Dedup by id (Strict Mode double-fetch / overlapping pages)
            const seen = new Set(prev.map((r) => r.id));
            const merged = [...prev];
            for (const r of page) {
              if (seen.has(r.id)) continue;
              seen.add(r.id);
              merged.push(r);
            }
            return merged;
          });
          setHasMore(hasMoreData);
        } else if (offset === 0) {
          setRuns([]);
          setLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load runs',
          );
        }
      })
      .catch((err) => {
        if (cancelled || offset !== 0) return;
        setRuns([]);
        const msg = err instanceof Error ? err.message : 'Failed to load runs';
        setLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load runs',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [client, props.workflowId, props.refreshKey, offset]);

  const filteredRuns = filterRunsByStatus(runs, filter);

  // Keep chip order/keys in sync with RUN_STATUS_FILTERS prefs module
  const FILTERS = RUN_STATUS_FILTERS.map((key) => {
    const [i18nKey, fallback] = FILTER_LABEL_KEYS[key];
    return { key, label: t(i18nKey, fallback) };
  });

  if (runs.length === 0 && offset === 0) {
    return (
      <p className={`p-3 text-xs ${loadError ? 'text-red-400' : ''}`} style={loadError ? undefined : { color: 'var(--text-muted)' }}>
        {loadError
          ? scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError
          : 'No runs yet.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Filter buttons + clear */}
      <div className="flex flex-wrap items-center gap-1 border-b p-2" style={{ borderColor: 'var(--border-primary)' }}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleFilter(key)}
            className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: filter === key ? 'var(--bg-accent, #3b82f6)' : 'var(--bg-tertiary)',
              color: filter === key ? '#fff' : 'var(--text-muted)',
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto rounded px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Clear completed runs"
          onClick={async () => {
            if (!client) return;
            if (!window.confirm('Delete all completed runs for this workflow?')) return;
            try {
              const res = await client.clearWorkflowRuns(props.workflowId, 'completed');
              if (res.ok) {
                setRuns((prev) => prev.filter((r) => r.status !== 'completed'));
                setSelectedRunId(null);
              } else {
                window.alert(
                  scrubDisplayText((res as { error?: string }).error, {
                    collapseLines: true,
                    maxChars: 300,
                  }) || 'Clear failed',
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Clear failed';
              window.alert(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Clear failed',
              );
            }
          }}
        >
          Clear completed
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Clear failed runs"
          onClick={async () => {
            if (!client) return;
            if (!window.confirm('Delete all failed runs for this workflow?')) return;
            try {
              const res = await client.clearWorkflowRuns(props.workflowId, 'failed');
              if (res.ok) {
                setRuns((prev) => prev.filter((r) => r.status !== 'failed'));
                setSelectedRunId(null);
              } else {
                window.alert(
                  scrubDisplayText((res as { error?: string }).error, {
                    collapseLines: true,
                    maxChars: 300,
                  }) || 'Clear failed',
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Clear failed';
              window.alert(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Clear failed',
              );
            }
          }}
        >
          Clear failed
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Clear cancelled runs"
          onClick={async () => {
            if (!client) return;
            if (!window.confirm('Delete all cancelled runs for this workflow?')) return;
            try {
              const res = await client.clearWorkflowRuns(props.workflowId, 'cancelled');
              if (res.ok) {
                setRuns((prev) => prev.filter((r) => r.status !== 'cancelled'));
                setSelectedRunId(null);
              } else {
                window.alert(
                  scrubDisplayText((res as { error?: string }).error, {
                    collapseLines: true,
                    maxChars: 300,
                  }) || 'Clear failed',
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Clear failed';
              window.alert(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Clear failed',
              );
            }
          }}
        >
          Clear cancelled
        </button>
      </div>

      <div className="border-b px-2 pb-1 text-[10px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
        {formatListCount(filteredRuns.length, runs.length)} shown
      </div>

      <div className="space-y-2 overflow-y-auto p-3">
        {filteredRuns.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No runs match the current filter.
          </p>
        ) : null}
        {filteredRuns.map((run) => {
          const nodeResults = run.nodeResults ?? {};
          const failedCount = Object.values(nodeResults).filter((value) => {
            const result = value as { status?: string };
            return normalizeRunStatus(result.status) === 'failed';
          }).length;
          const rawError = run.error ?? Object.values(nodeResults).map((value) => {
            const result = value as { error?: string };
            return result.error;
          }).find(Boolean);
          // Collapse control-char errors for list display (align with RunLogPanel)
          const firstError = rawError
            ? scrubDisplayText(rawError, { collapseLines: true, maxChars: 500 })
            : undefined;
          const statusLabel = scrubDisplayText(run.status, { collapseLines: true, maxChars: 40 })
            || normalizeRunStatus(run.status)
            || 'unknown';
          const runIdSafe = scrubDisplayText(run.id, { collapseLines: true, maxChars: 100 }) || 'run';

          const isSelected = selectedRunId === run.id;

          return (
            <div
              // Prefer raw run.id for React identity (unique); scrub only for display
              key={typeof run.id === 'string' && run.id ? run.id : runIdSafe}
              className="group relative cursor-pointer rounded-md border p-2 text-xs transition-colors"
              style={{
                borderColor: isSelected ? 'var(--border-accent, #3b82f6)' : 'var(--border-primary)',
                backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              }}
              onClick={() => setSelectedRunId(isSelected ? null : run.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {statusLabel}
                </span>
                <div className="flex items-center gap-1">
                  <span style={{ color: 'var(--text-muted)' }}>{runIdSafe.slice(0, 8)}</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!client) return;
                      try {
                        const res = await client.getWorkflowRun(props.workflowId, run.id);
                        if (!res.ok || !res.data) {
                          window.alert(
                            scrubDisplayText((res as { error?: string }).error, {
                              collapseLines: true,
                              maxChars: 300,
                            }) || 'Export failed',
                          );
                          return;
                        }
                        const blob = new Blob([JSON.stringify(res.data, null, 2)], {
                          type: 'application/json',
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `run-${runIdSafe.slice(0, 8)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Export failed';
                        window.alert(
                          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
                          || 'Export failed',
                        );
                      }
                    }}
                    className="rounded px-1 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--text-muted)' }}
                    title="Export run JSON"
                  >
                    ⬇
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!client) return;
                      // Control-char / blank / overlong ids never sent to delete API
                      const wfId = safeEntityId(props.workflowId);
                      const runEntityId = safeEntityId(run.id);
                      if (!wfId || !runEntityId) {
                        window.alert('Run id contains invalid control characters');
                        return;
                      }
                      try {
                        const res = await client.deleteWorkflowRun(wfId, runEntityId);
                        if (!res.ok) {
                          window.alert(
                            scrubDisplayText((res as { error?: string }).error, {
                              collapseLines: true,
                              maxChars: 300,
                            }) || 'Delete failed',
                          );
                          return;
                        }
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Delete failed';
                        window.alert(
                          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
                          || 'Delete failed',
                        );
                        return;
                      }
                      setRuns((prev) => prev.filter((r) => r.id !== run.id && r.id !== runEntityId));
                      if (selectedRunId === run.id || selectedRunId === runEntityId) {
                        setSelectedRunId(null);
                      }
                    }}
                    className="rounded px-1 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--text-muted)' }}
                    title={t('run.delete')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p style={{ color: 'var(--text-muted)' }} title={formatAbsoluteTime(run.startedAt)}>
                {formatRelativeTime(run.startedAt)}
              </p>
              {run.completedAt && (
                <p style={{ color: 'var(--text-muted)' }}>
                  {formatDuration(run.startedAt, run.completedAt)}
                </p>
              )}
              {failedCount > 0 && <p className="text-red-300">{failedCount} failed nodes</p>}
              {firstError && <p className="truncate text-red-300">{firstError}</p>}
            </div>
          );
        })}

        {hasMore && (
          <button
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            className="mt-2 w-full rounded px-2 py-1 text-xs"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            {t('common.loadMore')}
          </button>
        )}
      </div>

      {selectedRunId && filteredRuns.some((r) => r.id === selectedRunId) && (
        <RunDetailPanel
          workflowId={props.workflowId}
          runId={selectedRunId}
          nodeLabelMap={props.nodeLabelMap}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  );
}
