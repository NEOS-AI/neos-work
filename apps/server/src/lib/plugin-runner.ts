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
  const pending = pendingRuns.get(runId);
  if (!pending || pending.stageId !== stageId) return false;
  pending.resolve(response);
  pendingRuns.delete(runId);
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
  const apiKey = settings['ANTHROPIC_API_KEY'] ?? settings['OPENAI_API_KEY'];
  if (!apiKey) return `[Stage ${stage.name}: No LLM API key configured]`;

  // Interpolate {{key}} placeholders in prompt
  let prompt = stage.prompt ?? `Perform the ${stage.name} step.`;
  for (const [key, val] of Object.entries(previousOutputs)) {
    prompt = prompt.replaceAll(`{{${key}}}`, val);
  }
  for (const [key, val] of Object.entries(context)) {
    prompt = prompt.replaceAll(`{{${key}}}`, String(val));
  }

  // Simple fetch call to Anthropic Messages API
  if (settings['ANTHROPIC_API_KEY']) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings['ANTHROPIC_API_KEY'],
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    const data = await res.json() as { content?: { text: string }[] };
    return data.content?.[0]?.text ?? '';
  }

  // Fallback: OpenAI
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings['OPENAI_API_KEY']}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
    }),
    signal,
  });
  const data = await res.json() as { choices?: { message: { content: string } }[] };
  return data.choices?.[0]?.message.content ?? '';
}
