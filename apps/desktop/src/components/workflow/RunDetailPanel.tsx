import { useEffect, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowRun } from '../../lib/engine.js';
import { formatDurationMs, serializeNodeOutput } from '../../lib/format-duration.js';

interface NodeRunResult {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  failed: '#ef4444',
  running: '#f59e0b',
  skipped: '#6b7280',
  pending: '#6b7280',
};

interface RunDetailPanelProps {
  workflowId: string;
  runId: string;
  nodeLabelMap?: Record<string, string>;
  onClose: () => void;
}

export function RunDetailPanel({ workflowId, runId, nodeLabelMap, onClose }: RunDetailPanelProps) {
  const { client } = useEngine();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    setLoading(true);
    setError('');
    client.getWorkflowRun(workflowId, runId)
      .then((res) => {
        if (res.ok && res.data) {
          setRun(res.data);
        } else {
          setError('Failed to load run details.');
        }
      })
      .catch(() => { setError('Network error.'); })
      .finally(() => { setLoading(false); });
  }, [client, workflowId, runId]);

  const nodeResults: NodeRunResult[] = run
    ? Object.values(run.nodeResults as Record<string, NodeRunResult>)
    : [];

  const handleCopyOutput = async (nodeId: string, output: unknown) => {
    try {
      await navigator.clipboard.writeText(serializeNodeOutput(output));
      setCopiedNodeId(nodeId);
      setTimeout(() => setCopiedNodeId((cur) => (cur === nodeId ? null : cur)), 1500);
    } catch {
      // clipboard may be unavailable
    }
  };

  return (
    <div
      className="flex flex-col gap-3 border-t p-3 text-xs"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          Run {runId.slice(0, 8)} — node results
        </span>
        <button
          onClick={onClose}
          className="rounded px-2 py-0.5 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          ✕
        </button>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {!loading && !error && nodeResults.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No node results recorded.</p>
      )}

      {nodeResults.map((nr) => (
        <div
          key={nr.nodeId}
          className="rounded-md border p-2"
          style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1 font-medium"
              style={{ color: STATUS_COLORS[nr.status] ?? '#6b7280' }}
            >
              {nr.status}
            </span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {nodeLabelMap?.[nr.nodeId] ?? nr.nodeId}
            </span>
            {nr.durationMs !== undefined && (
              <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {formatDurationMs(nr.durationMs)}
              </span>
            )}
            {nr.output !== undefined && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  marginLeft: nr.durationMs === undefined ? 'auto' : undefined,
                }}
                title="Copy node output"
                onClick={() => void handleCopyOutput(nr.nodeId, nr.output)}
              >
                {copiedNodeId === nr.nodeId ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {nr.error && (
            <p className="mt-1 rounded px-1 text-red-400" style={{ backgroundColor: '#450a0a33' }}>
              {nr.error}
            </p>
          )}

          {nr.output !== undefined && (
            <pre
              className="mt-1 max-h-40 overflow-auto rounded p-1 text-[10px]"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {serializeNodeOutput(nr.output)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
