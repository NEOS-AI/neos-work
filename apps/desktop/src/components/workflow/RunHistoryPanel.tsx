import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowRun } from '../../lib/engine.js';
import { RunDetailPanel } from './RunDetailPanel.js';

type RunFilter = 'all' | 'completed' | 'failed' | 'cancelled';

function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const PAGE_SIZE = 20;

export function RunHistoryPanel(props: { workflowId: string; refreshKey: number; nodeLabelMap?: Record<string, string> }) {
  const { client } = useEngine();
  const { t } = useTranslation('common');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setOffset(0);
    setRuns([]);
  }, [props.workflowId, props.refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client.listWorkflowRuns(props.workflowId, PAGE_SIZE + 1, offset).then((res) => {
      if (!cancelled && res.ok && res.data) {
        const fetched = res.data;
        const hasMoreData = fetched.length > PAGE_SIZE;
        const page = fetched.slice(0, PAGE_SIZE);
        setRuns((prev) => (offset === 0 ? page : [...prev, ...page]));
        setHasMore(hasMoreData);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [client, props.workflowId, props.refreshKey, offset]);

  const filteredRuns = runs.filter((r) => filter === 'all' || r.status === filter);

  const FILTERS: { key: RunFilter; label: string }[] = [
    { key: 'all', label: t('run.filterAll') },
    { key: 'completed', label: t('run.filterCompleted') },
    { key: 'failed', label: t('run.filterFailed') },
    { key: 'cancelled', label: t('run.filterCancelled') },
  ];

  if (runs.length === 0 && offset === 0) {
    return (
      <p className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        No runs yet.
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
            onClick={() => setFilter(key)}
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
            const res = await client.clearWorkflowRuns(props.workflowId, 'completed');
            if (res.ok) {
              setRuns((prev) => prev.filter((r) => r.status !== 'completed'));
              setSelectedRunId(null);
            }
          }}
        >
          Clear completed
        </button>
      </div>

      <div className="space-y-2 overflow-y-auto p-3">
        {filteredRuns.map((run) => {
          const nodeResults = run.nodeResults ?? {};
          const failedCount = Object.values(nodeResults).filter((value) => {
            const result = value as { status?: string };
            return result.status === 'failed';
          }).length;
          const firstError = run.error ?? Object.values(nodeResults).map((value) => {
            const result = value as { error?: string };
            return result.error;
          }).find(Boolean);

          const isSelected = selectedRunId === run.id;

          return (
            <div
              key={run.id}
              className="group relative cursor-pointer rounded-md border p-2 text-xs transition-colors"
              style={{
                borderColor: isSelected ? 'var(--border-accent, #3b82f6)' : 'var(--border-primary)',
                backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              }}
              onClick={() => setSelectedRunId(isSelected ? null : run.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {run.status}
                </span>
                <div className="flex items-center gap-1">
                  <span style={{ color: 'var(--text-muted)' }}>{run.id.slice(0, 8)}</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!client) return;
                      const res = await client.getWorkflowRun(props.workflowId, run.id);
                      if (!res.ok || !res.data) return;
                      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `run-${run.id.slice(0, 8)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
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
                      await client.deleteWorkflowRun(props.workflowId, run.id).catch(() => {});
                      setRuns((prev) => prev.filter((r) => r.id !== run.id));
                      if (selectedRunId === run.id) setSelectedRunId(null);
                    }}
                    className="rounded px-1 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--text-muted)' }}
                    title={t('run.delete')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p style={{ color: 'var(--text-muted)' }}>{new Date(run.startedAt).toLocaleString()}</p>
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

      {selectedRunId && (
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
