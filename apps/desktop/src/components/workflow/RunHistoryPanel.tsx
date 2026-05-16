import { useEffect, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowRun } from '../../lib/engine.js';

export function RunHistoryPanel(props: { workflowId: string; refreshKey: number }) {
  const { client } = useEngine();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client.listWorkflowRuns(props.workflowId).then((res) => {
      if (!cancelled && res.ok && res.data) setRuns(res.data.slice(0, 20));
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [client, props.workflowId, props.refreshKey]);

  if (runs.length === 0) {
    return (
      <p className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        No runs yet.
      </p>
    );
  }

  return (
    <div className="space-y-2 overflow-y-auto p-3">
      {runs.map((run) => {
        const nodeResults = run.nodeResults ?? {};
        const failedCount = Object.values(nodeResults).filter((value) => {
          const result = value as { status?: string };
          return result.status === 'failed';
        }).length;
        const firstError = run.error ?? Object.values(nodeResults).map((value) => {
          const result = value as { error?: string };
          return result.error;
        }).find(Boolean);

        return (
          <div key={run.id} className="rounded-md border p-2 text-xs" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {run.status}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{run.id.slice(0, 8)}</span>
            </div>
            <p style={{ color: 'var(--text-muted)' }}>{new Date(run.startedAt).toLocaleString()}</p>
            {run.completedAt && (
              <p style={{ color: 'var(--text-muted)' }}>Completed {new Date(run.completedAt).toLocaleString()}</p>
            )}
            {failedCount > 0 && <p className="text-red-300">{failedCount} failed nodes</p>}
            {firstError && <p className="truncate text-red-300">{firstError}</p>}
          </div>
        );
      })}
    </div>
  );
}
