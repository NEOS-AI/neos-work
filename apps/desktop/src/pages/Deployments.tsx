import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { Deployment, Workflow } from '../lib/engine.js';

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  success: { bg: '#065f4620', color: '#059669' },
  failed: { bg: '#7f1d1d20', color: '#ef4444' },
  deploying: { bg: '#1e3a8a20', color: '#3b82f6' },
  pending: { bg: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
};

export function Deployments() {
  const { client } = useEngine();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, Workflow>>({});
  const [loading, setLoading] = useState(true);
  const [filterWorkflowId, setFilterWorkflowId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    const [dRes, wRes] = await Promise.all([
      client.listDeployments(filterWorkflowId || undefined),
      client.listWorkflows(),
    ]);
    if (dRes.ok && dRes.data) setDeployments(dRes.data);
    else setError((dRes as { error?: string }).error ?? 'Failed to load deployments');
    if (wRes.ok && wRes.data) {
      const map: Record<string, Workflow> = {};
      for (const w of wRes.data) map[w.id] = w;
      setWorkflows(map);
    }
    setLoading(false);
  }, [client, filterWorkflowId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!client) return;
    if (!window.confirm('Remove this deployment history entry?')) return;
    const res = await client.deleteDeployment(id);
    if (res.ok) setDeployments((prev) => prev.filter((d) => d.id !== id));
  };

  const workflowOptions = Object.values(workflows).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Deployments
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            History of Vercel and Cloudflare Pages deploys from Deploy nodes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterWorkflowId}
            onChange={(e) => setFilterWorkflowId(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={{
              borderColor: 'var(--border-secondary)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">All workflows</option>
            {workflowOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: 'var(--border-secondary)',
              color: 'var(--text-secondary)',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      ) : deployments.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center text-sm"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
        >
          No deployments yet. Add a Deploy node to a workflow and run it after configuring tokens in Settings.
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Workflow</th>
                <th className="px-4 py-3 font-medium">URL</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => {
                const st = STATUS_STYLES[d.status] ?? STATUS_STYLES.pending;
                const wfName = d.workflowId ? workflows[d.workflowId]?.name : undefined;
                return (
                  <tr
                    key={d.id}
                    className="border-t"
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: st.bg, color: st.color }}
                      >
                        {d.status}
                      </span>
                      {d.statusMessage && (
                        <p className="mt-1 max-w-[12rem] truncate text-xs" style={{ color: 'var(--text-muted)' }} title={d.statusMessage}>
                          {d.statusMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize">{d.provider}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {d.projectName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {d.workflowId ? (
                        <Link
                          to={`/workflows/${d.workflowId}`}
                          className="text-blue-400 hover:underline"
                        >
                          {wfName ?? d.workflowId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          className="max-w-[14rem] truncate text-blue-400 hover:underline"
                          title={d.url}
                        >
                          {d.url.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatWhen(d.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(d.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
