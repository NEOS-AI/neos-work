/**
 * Plugin runner — executes a plugin's atom pipeline stage by stage
 * Supports human-in-the-loop via SSE pause/resume
 */

import crypto from 'node:crypto';
import type { PluginManifest, PipelineStage } from './plugin-store.js';

export type PluginSSEEvent =
  | { type: 'pipeline.started'; runId: string; pluginId: string }
  | { type: 'stage.started'; stageId: string; stageName: string }
  | { type: 'stage.output'; stageId: string; output: string }
  | { type: 'stage.waiting'; stageId: string; surface: string; schema: unknown }
  | { type: 'stage.completed'; stageId: string; output: string }
  | { type: 'pipeline.completed'; runId: string; outputs: Record<string, string> }
  | { type: 'pipeline.failed'; runId: string; error: string };

// In-memory run state for resume
const pendingRuns = new Map<string, {
  resolve: (response: Record<string, unknown>) => void;
  stageId: string;
}>();

export interface RunnerOptions {
  plugin: PluginManifest;
  inputs: Record<string, unknown>;
  settings: Record<string, string>;
  onEvent: (event: PluginSSEEvent) => void;
  signal?: AbortSignal;
}

export async function runPlugin(options: RunnerOptions): Promise<string> {
  const { plugin, inputs, settings, onEvent, signal } = options;
  const runId = crypto.randomUUID();

  onEvent({ type: 'pipeline.started', runId, pluginId: plugin.id });

  const stages = plugin.pipeline ?? [];
  const stageOutputs: Record<string, string> = {};

  // Build initial context from inputs
  const context: Record<string, unknown> = { ...inputs };

  try {
    for (const stage of stages) {
      if (signal?.aborted) break;

      onEvent({ type: 'stage.started', stageId: stage.id, stageName: stage.name });

      if (stage.humanInLoop) {
        // Pause and wait for resume
        const response = await waitForResume(runId, stage, onEvent, signal);
        const output = JSON.stringify(response);
        stageOutputs[stage.outputKey ?? stage.id] = output;
        onEvent({ type: 'stage.completed', stageId: stage.id, output });
      } else {
        // Execute stage via LLM
        const output = await executeStage(stage, context, stageOutputs, settings, signal);
        stageOutputs[stage.outputKey ?? stage.id] = output;
        if (stage.outputKey) context[stage.outputKey] = output;
        onEvent({ type: 'stage.output', stageId: stage.id, output });
        onEvent({ type: 'stage.completed', stageId: stage.id, output });
      }
    }

    onEvent({ type: 'pipeline.completed', runId, outputs: stageOutputs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipeline error';
    onEvent({ type: 'pipeline.failed', runId, error: msg });
  }

  return runId;
}

export function resumeRun(runId: string, stageId: string, response: Record<string, unknown>): boolean {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const sid = typeof stageId === 'string' ? stageId.trim() : '';
  if (!rid || !sid) return false;
  const pending = pendingRuns.get(rid);
  if (!pending || pending.stageId !== sid) return false;
  pending.resolve(response ?? {});
  pendingRuns.delete(rid);
  return true;
}

async function waitForResume(
  runId: string,
  stage: PipelineStage,
  onEvent: (e: PluginSSEEvent) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  onEvent({
    type: 'stage.waiting',
    stageId: stage.id,
    surface: stage.kind,
    schema: stage.schema ?? null,
  });

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    pendingRuns.set(runId, { resolve, stageId: stage.id });
    signal?.addEventListener('abort', () => {
      pendingRuns.delete(runId);
      reject(new Error('Aborted'));
    });
  });
}

async function executeStage(
  stage: PipelineStage,
  context: Record<string, unknown>,
  previousOutputs: Record<string, string>,
  settings: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  // Trim first so whitespace-only Anthropic does not block OpenAI fallback
  const anthropicKey = String(settings['ANTHROPIC_API_KEY'] ?? '').trim();
  const openaiKey = String(settings['OPENAI_API_KEY'] ?? '').trim();
  // Trim stage name for user-facing placeholders
  const stageName = typeof stage.name === 'string' ? stage.name.trim() || stage.id : stage.id;

  if (!anthropicKey && !openaiKey) {
    return `[Stage ${stageName}: No LLM API key configured]`;
  }

  // Interpolate {{key}} placeholders in prompt (trim so whitespace-only falls back)
  let prompt =
    typeof stage.prompt === 'string' && stage.prompt.trim()
      ? stage.prompt.trim()
      : `Perform the ${stageName} step.`;
  for (const [key, val] of Object.entries(previousOutputs)) {
    prompt = prompt.replaceAll(`{{${key}}}`, val);
  }
  for (const [key, val] of Object.entries(context)) {
    prompt = prompt.replaceAll(`{{${key}}}`, String(val));
  }

  // Anthropic Messages API
  if (anthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal,
      });
      if (!res.ok) {
        return `[Stage ${stageName}: Anthropic API error ${res.status}]`;
      }
      const data = await res.json() as { content?: { text: string }[] };
      return data.content?.[0]?.text ?? '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LLM request failed';
      return `[Stage ${stageName}: ${msg}]`;
    }
  }

  // Fallback: OpenAI
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
      }),
      signal,
    });
    if (!res.ok) {
      return `[Stage ${stageName}: OpenAI API error ${res.status}]`;
    }
    const data = await res.json() as { choices?: { message: { content: string } }[] };
    return data.choices?.[0]?.message.content ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM request failed';
    return `[Stage ${stageName}: ${msg}]`;
  }
}
