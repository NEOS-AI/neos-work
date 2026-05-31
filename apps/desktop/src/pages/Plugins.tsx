import { useState, useEffect, useCallback } from 'react';
import { useEngine } from '../hooks/useEngine.js';
import { GenUIForm } from '../components/workflow/GenUIForm.js';
import { GenUIChoice } from '../components/workflow/GenUIChoice.js';

interface PipelineStage {
  id: string;
  name: string;
  kind: string;
  humanInLoop?: boolean;
  schema?: unknown;
}

interface Plugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  pipeline?: PipelineStage[];
  inputFields?: { key: string; label: string; type: string; placeholder?: string }[];
}

interface StageLog {
  stageId: string;
  stageName: string;
  output?: string;
  status: 'running' | 'waiting' | 'done';
}

interface RunState {
  runId: string | null;
  stages: StageLog[];
  waiting: { stageId: string; surface: string; schema: unknown } | null;
  completed: boolean;
  failed: string | null;
}

interface RunnerModalProps {
  plugin: Plugin;
  onClose: () => void;
}

function RunnerModal({ plugin, onClose }: RunnerModalProps) {
  const { client } = useEngine();
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries((plugin.inputFields ?? []).map((f) => [f.key, ''])),
  );
  const [run, setRun] = useState<RunState | null>(null);
  const [stopFn, setStopFn] = useState<(() => void) | null>(null);

  const handleStart = useCallback(() => {
    if (!client || run) return;
    const newRun: RunState = { runId: null, stages: [], waiting: null, completed: false, failed: null };
    setRun(newRun);

    const { stop, runIdPromise } = client.runPlugin(plugin.id, inputs, (event: unknown) => {
      const e = event as Record<string, unknown>;
      setRun((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        switch (e.type) {
          case 'pipeline.started':
            next.runId = e.runId as string;
            break;
          case 'stage.started':
            next.stages = [
              ...next.stages,
              { stageId: e.stageId as string, stageName: e.stageName as string, status: 'running' },
            ];
            break;
          case 'stage.waiting':
            next.waiting = { stageId: e.stageId as string, surface: e.surface as string, schema: e.schema };
            next.stages = next.stages.map((s) =>
              s.stageId === e.stageId ? { ...s, status: 'waiting' } : s,
            );
            break;
          case 'stage.completed':
            next.stages = next.stages.map((s) =>
              s.stageId === e.stageId ? { ...s, output: e.output as string, status: 'done' } : s,
            );
            if (next.waiting?.stageId === e.stageId) next.waiting = null;
            break;
          case 'pipeline.completed':
            next.completed = true;
            next.waiting = null;
            break;
          case 'pipeline.failed':
            next.failed = e.error as string;
            break;
        }
        return next;
      });
    });

    runIdPromise.then((id) => {
      if (id) setRun((prev) => prev ? { ...prev, runId: id } : prev);
    });
    setStopFn(() => stop);
  }, [client, plugin.id, inputs, run]);

  const handleResume = useCallback(
    async (stageId: string, response: Record<string, unknown>) => {
      if (!client || !run?.runId) return;
      await client.resumePlugin(plugin.id, run.runId, stageId, response);
    },
    [client, plugin.id, run],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
            {plugin.name}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Input fields */}
          {!run && (plugin.inputFields ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Inputs</p>
              {(plugin.inputFields ?? []).map((f) => (
                <div key={f.key}>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                  <input
                    className="w-full rounded px-3 py-1.5 text-sm border"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder={f.placeholder}
                    value={inputs[f.key] ?? ''}
                    onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Stage progress */}
          {run && (
            <div className="space-y-2">
              {(plugin.pipeline ?? []).map((stage, i) => {
                const log = run.stages.find((s) => s.stageId === stage.id);
                const statusColor = log?.status === 'done' ? '#10b981' : log?.status === 'waiting' ? '#f59e0b' : log?.status === 'running' ? '#3b82f6' : 'var(--text-muted)';
                return (
                  <div key={stage.id} className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                      style={{ backgroundColor: statusColor }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{stage.name}</p>
                      {log?.output && (
                        <p className="text-xs mt-1 whitespace-pre-wrap truncate" style={{ color: 'var(--text-muted)' }}>
                          {log.output.slice(0, 200)}{log.output.length > 200 ? '…' : ''}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Human-in-loop surface */}
          {run?.waiting && (
            <div className="rounded-lg p-4 border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
              <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Your input needed</p>
              {run.waiting.surface === 'form' && (
                <GenUIForm
                  schema={run.waiting.schema as { fields: { key: string; label: string; type: 'text' | 'select' | 'textarea'; placeholder?: string; options?: string[] }[] }}
                  onSubmit={(values) => handleResume(run.waiting!.stageId, values)}
                />
              )}
              {run.waiting.surface === 'choice' && (
                <GenUIChoice
                  schema={run.waiting.schema as { prompt?: string; options: { label: string; previewUrl?: string; value?: string }[] }}
                  onSelect={(value) => handleResume(run.waiting!.stageId, { choice: value })}
                />
              )}
              {run.waiting.surface === 'confirmation' && (
                <div className="flex gap-2">
                  <button
                    className="rounded px-4 py-1.5 text-sm text-white"
                    style={{ backgroundColor: '#10b981' }}
                    onClick={() => handleResume(run.waiting!.stageId, { confirmed: true })}
                  >
                    Continue
                  </button>
                  <button
                    className="rounded px-4 py-1.5 text-sm"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                    onClick={() => handleResume(run.waiting!.stageId, { confirmed: false })}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {run?.completed && (
            <p className="text-sm text-green-400">Pipeline completed successfully.</p>
          )}
          {run?.failed && (
            <p className="text-sm text-red-400">Error: {run.failed}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-primary)' }}>
          {!run && (
            <button
              className="rounded px-4 py-1.5 text-sm text-white"
              style={{ backgroundColor: '#10b981' }}
              onClick={handleStart}
            >
              Run Pipeline
            </button>
          )}
          {run && !run.completed && !run.failed && (
            <button
              className="rounded px-4 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
              onClick={() => { stopFn?.(); setRun(null); }}
            >
              Stop
            </button>
          )}
          <button
            className="rounded px-4 py-1.5 text-sm"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function Plugins() {
  const { client } = useEngine();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Plugin | null>(null);

  useEffect(() => {
    if (!client) return;
    client.listPlugins().then((res: { ok: boolean; data?: Plugin[] }) => {
      if (res.ok && res.data) setPlugins(res.data);
      setLoading(false);
    });
  }, [client]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Plugins</h1>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : plugins.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No plugins found. Add <code>open-design.json</code> to a skill directory.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            ~/.config/neos-work/skills/&lt;plugin-name&gt;/open-design.json
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-xl p-4 cursor-pointer transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {plugin.name}
                </h3>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: '#10b98133', color: '#10b981' }}
                >
                  Plugin
                </span>
              </div>
              {plugin.description && (
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  {plugin.description}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  v{plugin.version} · {(plugin.pipeline ?? []).length} stages
                </span>
                <button
                  className="text-xs rounded px-2.5 py-1 text-white"
                  style={{ backgroundColor: '#10b981' }}
                  onClick={() => setSelected(plugin)}
                >
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <RunnerModal plugin={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
