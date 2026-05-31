import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { Routine, RoutineRun, Workflow } from '../lib/engine.js';

export function Routines() {
  const { client } = useEngine();
  const { t } = useTranslation('common');
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);

  // Form state
  const [formName, setFormName] = useState('');
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formSchedule, setFormSchedule] = useState('0 9 * * *');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!client) return;
    const [rRes, wRes] = await Promise.all([client.listRoutines(), client.listWorkflows()]);
    if (rRes.ok && rRes.data) setRoutines(rRes.data);
    if (wRes.ok && wRes.data) setWorkflows(wRes.data);
  };

  useEffect(() => { load(); }, [client]);

  useEffect(() => {
    if (!client || !selectedId) return;
    client.listRoutineRuns(selectedId).then((res) => {
      if (res.ok && res.data) setRuns(res.data);
    });
  }, [client, selectedId]);

  const handleCreate = async () => {
    if (!client) return;
    if (!formName.trim()) { setFormError('Name is required'); return; }
    if (!formWorkflowId) { setFormError('Select a workflow'); return; }
    if (!formSchedule.trim()) { setFormError('Schedule is required'); return; }
    setSubmitting(true);
    setFormError('');
    const res = await client.createRoutine({
      name: formName.trim(),
      workflowId: formWorkflowId,
      schedule: formSchedule.trim(),
      enabled: formEnabled,
    });
    setSubmitting(false);
    if (!res.ok) { setFormError((res as { error?: string }).error ?? 'Failed'); return; }
    setCreateOpen(false);
    setFormName('');
    setFormWorkflowId('');
    setFormSchedule('0 9 * * *');
    setFormEnabled(true);
    await load();
  };

  const handleToggle = async (routine: Routine) => {
    if (!client) return;
    await client.updateRoutine(routine.id, { enabled: !routine.enabled });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!client || !confirm('Delete this routine?')) return;
    await client.deleteRoutine(id);
    if (selectedId === id) setSelectedId(null);
    await load();
  };

  const handleRun = async (id: string) => {
    if (!client) return;
    const res = await client.runRoutineNow(id);
    if (res.ok) {
      alert(`Triggered! runId: ${res.data?.runId?.slice(0, 8)}`);
      await load();
    }
  };

  const schedulePresets = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at 9 AM (UTC)', value: '0 9 * * *' },
    { label: 'Every Monday 9 AM', value: '0 9 * * 1' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
  ];

  const selectedRoutine = routines.find((r) => r.id === selectedId);

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-80 flex flex-col border-r" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Routines
          </h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded px-2 py-1 text-xs text-white"
            style={{ backgroundColor: '#10b981' }}
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {routines.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              No routines. Create one to automate workflows.
            </div>
          ) : (
            routines.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className="cursor-pointer px-4 py-3 border-b"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: selectedId === r.id ? 'var(--bg-secondary)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {r.name}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${r.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}`}
                  >
                    {r.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {r.schedule}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {workflows.find((w) => w.id === r.workflowId)?.name ?? r.workflowId}
                </div>
                {r.lastRunAt && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Last: {new Date(r.lastRunAt).toLocaleString()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedRoutine ? (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Select a routine to manage it
          </div>
        ) : (
          <div className="max-w-xl space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedRoutine.name}
                </h3>
                <p className="text-sm mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {selectedRoutine.schedule}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggle(selectedRoutine)}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  {selectedRoutine.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleRun(selectedRoutine.id)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white"
                  style={{ backgroundColor: '#3b82f6' }}
                >
                  ▶ Run Now
                </button>
                <button
                  onClick={() => handleDelete(selectedRoutine.id)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-red-400"
                  style={{ backgroundColor: '#450a0a33' }}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="rounded-lg p-4 text-sm space-y-1" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Workflow</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {workflows.find((w) => w.id === selectedRoutine.workflowId)?.name ?? selectedRoutine.workflowId}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span className={selectedRoutine.enabled ? 'text-green-400' : 'text-gray-400'}>
                  {selectedRoutine.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Created</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {new Date(selectedRoutine.createdAt).toLocaleString()}
                </span>
              </div>
              {selectedRoutine.lastRunAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Last Run</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedRoutine.lastRunAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Run history */}
            <div>
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                Run History
              </h4>
              {runs.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No runs yet</p>
              ) : (
                <div className="space-y-1">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded px-3 py-2 text-xs"
                      style={{ backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <span style={{ color: 'var(--text-primary)' }}>
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                      <span className={
                        run.status === 'completed' ? 'text-green-400' :
                        run.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                      }>
                        {run.status}
                      </span>
                      {run.error && (
                        <span className="text-red-400 truncate max-w-[160px]" title={run.error}>
                          {run.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl p-6 space-y-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              New Routine
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Name</label>
                <input
                  className="w-full rounded px-3 py-1.5 text-sm border"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Daily digest"
                />
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Workflow</label>
                <select
                  className="w-full rounded px-3 py-1.5 text-sm border"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                  value={formWorkflowId}
                  onChange={(e) => setFormWorkflowId(e.target.value)}
                >
                  <option value="">— Select workflow —</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Schedule (cron)
                </label>
                <div className="flex gap-1 flex-wrap mb-1">
                  {schedulePresets.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setFormSchedule(p.value)}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: formSchedule === p.value ? '#3b82f6' : 'var(--bg-tertiary)',
                        color: formSchedule === p.value ? 'white' : 'var(--text-muted)',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  className="w-full rounded px-3 py-1.5 text-sm border font-mono"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                  value={formSchedule}
                  onChange={(e) => setFormSchedule(e.target.value)}
                  placeholder="0 9 * * *"
                />
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  UTC timezone · minute hour day month weekday
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                />
                Enable immediately
              </label>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setCreateOpen(false); setFormError(''); }}
                className="rounded px-3 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="rounded px-3 py-1.5 text-xs text-white"
                style={{ backgroundColor: '#10b981' }}
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
