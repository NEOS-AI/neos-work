import { useState, useCallback, useEffect } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { Plugin } from '../../lib/engine.js';
import { scrubDisplayText } from '../../lib/format-duration.js';
import { GenUIForm } from './GenUIForm.js';
import { GenUIChoice } from './GenUIChoice.js';
import { GenUIConfirmation } from './GenUIConfirmation.js';

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

interface PipelineRunnerProps {
  plugin: Plugin;
  onClose: () => void;
}

/** Control-char / blank pipeline ids rejected (stageId, runId, plugin id). */
function safePipelineId(raw: unknown, max = 100): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > max) return '';
  return s;
}

/** Only known GenUI surfaces accepted for waiting stages. */
function safePipelineSurface(raw: unknown): string {
  const s = safePipelineId(raw, 40);
  if (s === 'form' || s === 'choice' || s === 'confirmation') return s;
  return '';
}

export function PipelineRunner({ plugin, onClose }: PipelineRunnerProps) {
  const { client } = useEngine();
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries((plugin.inputFields ?? []).map((f) => [f.key, ''])),
  );
  const [run, setRun] = useState<RunState | null>(null);
  const [stopFn, setStopFn] = useState<(() => void) | null>(null);

  // Escape closes modal; stop in-flight pipeline stream when closing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      stopFn?.();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stopFn]);

  const handleStart = useCallback(() => {
    if (!client || run) return;
    const newRun: RunState = { runId: null, stages: [], waiting: null, completed: false, failed: null };
    setRun(newRun);

    // Trim plugin run inputs so resume/stage context stays clean (plan Task 5/6).
    // Control-char keys dropped; null-byte values skipped (align with server resume hygiene).
    const trimmedInputs: Record<string, string> = {};
    for (const [key, value] of Object.entries(inputs)) {
      if (Object.keys(trimmedInputs).length >= 200) break;
      if (typeof key !== 'string' || /[\0\r\n]/.test(key)) continue;
      const k = key.trim();
      if (!k || k.length > 200) continue;
      if (typeof value === 'string' && /\0/.test(value)) continue;
      trimmedInputs[k] =
        typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    }

    // Control-char plugin id → no-op (check before trim)
    if (typeof plugin.id !== 'string' || /[\0\r\n]/.test(plugin.id)) return;
    const pluginId = plugin.id.trim();
    if (!pluginId || pluginId.length > 100) return;

    const { stop, runIdPromise } = client.runPlugin(pluginId, trimmedInputs, (event: unknown) => {
      const e = event as Record<string, unknown>;
      setRun((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        switch (e.type) {
          case 'pipeline.started': {
            const runId = safePipelineId(e.runId, 100);
            if (runId) next.runId = runId;
            break;
          }
          case 'stage.started': {
            const stageId = safePipelineId(e.stageId, 100);
            if (!stageId) break;
            const stageName =
              scrubDisplayText(e.stageName, { collapseLines: true, maxChars: 120 }) || stageId;
            next.stages = [
              ...next.stages,
              { stageId, stageName, status: 'running' },
            ];
            break;
          }
          case 'stage.waiting': {
            const stageId = safePipelineId(e.stageId, 100);
            const surface = safePipelineSurface(e.surface);
            if (!stageId || !surface) break;
            next.waiting = { stageId, surface, schema: e.schema };
            next.stages = next.stages.map((s) =>
              s.stageId === stageId ? { ...s, status: 'waiting' } : s,
            );
            break;
          }
          case 'stage.completed': {
            const stageId = safePipelineId(e.stageId, 100);
            if (!stageId) break;
            next.stages = next.stages.map((s) =>
              s.stageId === stageId
                ? {
                    ...s,
                    output: scrubDisplayText(e.output, { maxChars: 2_000 }),
                    status: 'done',
                  }
                : s,
            );
            if (next.waiting?.stageId === stageId) next.waiting = null;
            break;
          }
          case 'pipeline.completed':
            next.completed = true;
            next.waiting = null;
            break;
          case 'pipeline.failed':
            next.failed =
              scrubDisplayText(e.error, { collapseLines: true, maxChars: 2_000 })
              || 'Pipeline failed';
            break;
        }
        return next;
      });
    });

    runIdPromise.then((id) => {
      const safe = safePipelineId(id, 100);
      if (safe) setRun((prev) => (prev ? { ...prev, runId: safe } : prev));
    });
    setStopFn(() => stop);
  }, [client, plugin.id, inputs, run]);

  const handleResume = useCallback(
    async (stageId: string, response: Record<string, unknown>) => {
      if (!client || !run?.runId) return;
      // Control-char stage / run / plugin ids never sent to resume API
      const sid = safePipelineId(stageId, 100);
      const rid = safePipelineId(run.runId, 100);
      const pid =
        typeof plugin.id === 'string' && !/[\0\r\n]/.test(plugin.id)
          ? plugin.id.trim().slice(0, 100)
          : '';
      if (!sid || !rid || !pid) return;
      const res = await client.resumePlugin(pid, rid, sid, response);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 500,
          }) || 'Resume failed';
        setRun((prev) =>
          prev
            ? {
                ...prev,
                waiting: null,
                failed: err,
              }
            : prev,
        );
      }
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
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
            {scrubDisplayText(plugin.name, { collapseLines: true, maxChars: 200 }) || 'Plugin'}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {!run && (plugin.inputFields ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Inputs</p>
              {(plugin.inputFields ?? [])
                .filter((f) => typeof f.key === 'string' && !/[\0\r\n]/.test(f.key) && f.key.trim())
                .map((f) => {
                  const key = f.key.trim();
                  const label = scrubDisplayText(f.label, { collapseLines: true, maxChars: 100 }) || key;
                  const placeholder = f.placeholder
                    ? scrubDisplayText(f.placeholder, { collapseLines: true, maxChars: 200 })
                    : undefined;
                  return (
                <div key={key}>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>{label}</label>
                  <input
                    className="w-full rounded px-3 py-1.5 text-sm border"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder={placeholder}
                    value={inputs[key] ?? inputs[f.key] ?? ''}
                    onChange={(e) => setInputs((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </div>
                  );
                })}
            </div>
          )}

          {run && (
            <div className="space-y-2">
              {(plugin.pipeline ?? []).map((stage, i) => {
                const log = run.stages.find((s) => s.stageId === stage.id);
                const statusColor = log?.status === 'done' ? '#10b981' : log?.status === 'waiting' ? '#f59e0b' : log?.status === 'running' ? '#3b82f6' : 'var(--text-muted)';
                const stageName = scrubDisplayText(stage.name, { collapseLines: true, maxChars: 120 })
                  || scrubDisplayText(stage.id, { collapseLines: true, maxChars: 80 })
                  || `Stage ${i + 1}`;
                const outSafe = log?.output
                  ? scrubDisplayText(log.output, { maxChars: 220 })
                  : '';
                return (
                  <div key={stage.id} className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                      style={{ backgroundColor: statusColor }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{stageName}</p>
                      {outSafe ? (
                        <p className="text-xs mt-1 whitespace-pre-wrap truncate" style={{ color: 'var(--text-muted)' }}>
                          {outSafe.slice(0, 200)}{outSafe.length > 200 ? '…' : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
                <GenUIConfirmation
                  schema={run.waiting.schema as { prompt?: string; confirmLabel?: string; cancelLabel?: string } | undefined}
                  onConfirm={(confirmed) => handleResume(run.waiting!.stageId, { confirmed })}
                />
              )}
            </div>
          )}

          {run?.completed && (
            <p className="text-sm text-green-400">Pipeline completed successfully.</p>
          )}
          {run?.failed ? (
            <p className="text-sm text-red-400">
              Error: {scrubDisplayText(run.failed, { collapseLines: true, maxChars: 500 })}
            </p>
          ) : null}
        </div>

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
