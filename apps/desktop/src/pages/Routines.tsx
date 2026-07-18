import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { Routine, RoutineRun, Workflow } from '../lib/engine.js';
import { formatListCount } from '../lib/list-count.js';
import { filterByEnabled, filterBySearchText } from '../lib/workflow-list-filter.js';

export function Routines() {
  const { client } = useEngine();
  const { t } = useTranslation('common');
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  // Form state
  const [formName, setFormName] = useState('');
  const [formWorkflowId, setFormWorkflowId] = useState('');
  const [formSchedule, setFormSchedule] = useState('0 9 * * *');
  const [formTimezone, setFormTimezone] = useState('UTC');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit schedule for selected routine
  const [editSchedule, setEditSchedule] = useState('');
  const [editTimezone, setEditTimezone] = useState('UTC');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

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

  useEffect(() => {
    const r = routines.find((x) => x.id === selectedId);
    if (!r) return;
    setEditSchedule(r.schedule);
    setEditTimezone(r.timezone || 'UTC');
    setEditError('');
  }, [selectedId, routines]);

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
      timezone: formTimezone.trim() || 'UTC',
      enabled: formEnabled,
    });
    setSubmitting(false);
    if (!res.ok) { setFormError((res as { error?: string }).error ?? 'Failed'); return; }
    setCreateOpen(false);
    setFormName('');
    setFormWorkflowId('');
    setFormSchedule('0 9 * * *');
    setFormTimezone('UTC');
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
      if (selectedId === id) {
        const runsRes = await client.listRoutineRuns(id);
        if (runsRes.ok && runsRes.data) setRuns(runsRes.data);
      }
    }
  };

  const handleCrystallize = async (run: RoutineRun) => {
    if (!client || !selectedId) return;
    if (run.status !== 'completed') {
      alert('Only completed runs can be crystallized into a skill.');
      return;
    }
    if (!confirm('Save this successful run as a skill candidate?')) return;
    const res = await client.crystallizeRoutineRun(selectedId, run.id);
    if (res.ok && res.data) {
      alert(`Crystallized skill: ${res.data.name}\n${res.data.path}`);
    } else {
      alert((res as { error?: string }).error ?? 'Crystallize failed');
    }
  };

  const handleSaveSchedule = async () => {
    if (!client || !selectedId) return;
    if (!editSchedule.trim()) {
      setEditError('Schedule is required');
      return;
    }
    setEditSaving(true);
    setEditError('');
    const res = await client.updateRoutine(selectedId, {
      schedule: editSchedule.trim(),
      timezone: editTimezone.trim() || 'UTC',
    });
    setEditSaving(false);
    if (!res.ok) {
      setEditError((res as { error?: string }).error ?? 'Update failed');
      return;
    }
    await load();
  };

  const schedulePresets = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at 9 AM', value: '0 9 * * *' },
    { label: 'Every Monday 9 AM', value: '0 9 * * 1' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
  ];

  const timezonePresets = [
    'UTC',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Seoul',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];

  const selectedRoutine = routines.find((r) => r.id === selectedId);

  const visibleRoutines = useMemo(() => {
    const byEnabled = filterByEnabled(routines, enabledFilter);
    return filterBySearchText(byEnabled, search);
  }, [routines, enabledFilter, search]);

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-80 flex flex-col border-r" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Routines
          </h2>
          <div className="flex items-center gap-2">
            {routines.length > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {formatListCount(visibleRoutines.length, routines.length)}
              </span>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded px-2 py-1 text-xs text-white"
              style={{ backgroundColor: '#10b981' }}
            >
              + New
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-b p-3" style={{ borderColor: 'var(--border-primary)' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search routines…"
            className="w-full rounded-lg border px-2 py-1.5 text-xs"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
            }}
          />
          <div className="flex gap-1">
            {([
              { id: 'all', label: 'All' },
              { id: 'enabled', label: 'ON' },
              { id: 'disabled', label: 'OFF' },
            ] as const).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setEnabledFilter(chip.id)}
                className="rounded-md px-2 py-0.5 text-[10px] font-medium uppercase"
                style={{
                  backgroundColor: enabledFilter === chip.id ? 'var(--border-secondary)' : 'var(--bg-tertiary)',
                  color: enabledFilter === chip.id ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {routines.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              No routines. Create one to automate workflows.
            </div>
          ) : visibleRoutines.length === 0 ? (
            <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              No routines match filters.
            </div>
          ) : (
            visibleRoutines.map((r) => (
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
                  {r.schedule} · {r.timezone || 'UTC'}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {workflows.find((w) => w.id === r.workflowId)?.name ?? r.workflowId}
                </div>
                {r.lastRunAt && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Last: {new Date(r.lastRunAt).toLocaleString()}
                  </div>
                )}
                {r.nextRunAt && r.enabled && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Next: {new Date(r.nextRunAt).toLocaleString()}
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
                  {selectedRoutine.schedule} ({selectedRoutine.timezone || 'UTC'})
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
              {selectedRoutine.nextRunAt && selectedRoutine.enabled && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Next Run</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedRoutine.nextRunAt).toLocaleString()}
                  </span>
                </div>
              )}
              {selectedRoutine.lastRunAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Last Run</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedRoutine.lastRunAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            {/* Edit schedule / timezone */}
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
              <h4 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Schedule
              </h4>
              <div className="flex flex-wrap gap-1">
                {schedulePresets.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setEditSchedule(p.value)}
                    className="rounded px-2 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: editSchedule === p.value ? '#3b82f6' : 'var(--bg-tertiary)',
                      color: editSchedule === p.value ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={editSchedule}
                onChange={(e) => setEditSchedule(e.target.value)}
                className="w-full rounded border px-2 py-1.5 font-mono text-xs"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)',
                }}
                placeholder="0 9 * * *"
              />
              <div className="flex flex-wrap gap-1">
                {timezonePresets.map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => setEditTimezone(tz)}
                    className="rounded px-2 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: editTimezone === tz ? '#3b82f6' : 'var(--bg-tertiary)',
                      color: editTimezone === tz ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {tz}
                  </button>
                ))}
              </div>
              {editError && <p className="text-xs text-red-400">{editError}</p>}
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void handleSaveSchedule()}
                className="rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#10b981' }}
              >
                {editSaving ? 'Saving…' : 'Save schedule'}
              </button>
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
                      className="flex items-center justify-between gap-2 rounded px-3 py-2 text-xs"
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
                      {run.status === 'completed' && (
                        <button
                          type="button"
                          onClick={() => void handleCrystallize(run)}
                          className="rounded px-2 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: '#7c3aed' }}
                          title="Save as skill candidate"
                        >
                          Crystallize
                        </button>
                      )}
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
                  Cron fields: minute hour day month weekday · timezone selected below (DST-aware)
                </p>
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Timezone (IANA, DST-aware)
                </label>
                <select
                  className="w-full rounded px-3 py-1.5 text-sm border"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                >
                  {timezonePresets.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
                <input
                  className="w-full rounded px-3 py-1.5 text-sm border font-mono mt-1"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                  placeholder="Asia/Seoul"
                />
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
