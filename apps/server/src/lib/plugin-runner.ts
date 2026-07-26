/**
 * Plugin runner — executes a plugin's atom pipeline stage by stage
 * Supports human-in-the-loop via SSE pause/resume
 */

import crypto from 'node:crypto';

import { scrubErrorMessage } from '@neos-work/core';

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

      const stageIdRaw =
        typeof stage.id === 'string' ? stage.id : String(stage.id ?? '');
      // Control-char check before trim; skip malformed / unsafe stage ids
      if (!stageIdRaw || /[\0\r\n]/.test(stageIdRaw)) continue;
      const stageId = stageIdRaw.trim();
      if (!stageId || stageId.length > 100) continue;
      let stageName =
        typeof stage.name === 'string' && !/[\0\r\n]/.test(stage.name)
          ? stage.name.trim() || stageId
          : stageId;
      if (typeof stageName !== 'string') stageName = stageId;
      if (stageName.length > 200) stageName = stageName.slice(0, 200);
      let outputKeyRaw: string | undefined;
      if (typeof stage.outputKey === 'string' && !/[\0\r\n]/.test(stage.outputKey)) {
        const ok = stage.outputKey.trim();
        outputKeyRaw = ok && ok.length <= 100 ? ok : stageId;
      } else {
        outputKeyRaw = stageId;
      }
      const outputKey = (outputKeyRaw || stageId) as string;
      const normalizedStage = { ...stage, id: stageId, name: stageName, outputKey };

      onEvent({ type: 'stage.started', stageId, stageName });

      if (stage.humanInLoop) {
        // Pause and wait for resume
        const response = await waitForResume(runId, normalizedStage, onEvent, signal);
        let output = JSON.stringify(response ?? {});
        // Cap HITL response payload (align with stage output clamp)
        if (output.length > 200_000) {
          output = output.slice(0, 200_000) + '…[truncated]';
        }
        stageOutputs[outputKey] = output;
        onEvent({ type: 'stage.completed', stageId, output });
      } else {
        // Execute stage via LLM
        const output = await executeStage(normalizedStage, context, stageOutputs, settings, signal);
        stageOutputs[outputKey] = output;
        context[outputKey] = output;
        onEvent({ type: 'stage.output', stageId, output });
        onEvent({ type: 'stage.completed', stageId, output });
      }
    }

    onEvent({ type: 'pipeline.completed', runId, outputs: stageOutputs });
  } catch (err) {
    const msg =
      scrubErrorMessage(err instanceof Error ? err.message : 'Pipeline error', 4_000)
      || 'Pipeline error';
    onEvent({ type: 'pipeline.failed', runId, error: msg });
  }

  return runId;
}

function safePluginRunId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > 100) return '';
  return id;
}

export function resumeRun(runId: string, stageId: string, response: Record<string, unknown>): boolean {
  const rid = safePluginRunId(runId);
  const sid = safePluginRunId(stageId);
  if (!rid || !sid) return false;
  // Cap HITL response key count / payload (defense for resume API)
  const resp =
    response && typeof response === 'object' && !Array.isArray(response) ? response : {};
  const keys = Object.keys(resp);
  if (keys.length > 100) return false;
  try {
    if (JSON.stringify(resp).length > 256_000) return false;
  } catch {
    return false;
  }
  const pending = pendingRuns.get(rid);
  if (!pending || pending.stageId !== sid) return false;
  pending.resolve(resp);
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
  // Sanitize API keys before Authorization / x-api-key headers
  const sanitizeKey = (raw: unknown): string => {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const k = raw.trim();
    return k.length > 0 && k.length <= 8_192 ? k : '';
  };
  const anthropicKey = sanitizeKey(settings['ANTHROPIC_API_KEY']);
  const openaiKey = sanitizeKey(settings['OPENAI_API_KEY']);
  // Stage name already normalized upstream; scrub residual control chars for log text
  const stageName =
    typeof stage.name === 'string' && !/[\0\r\n]/.test(stage.name)
      ? stage.name.trim() || stage.id
      : stage.id;

  if (!anthropicKey && !openaiKey) {
    return `[Stage ${stageName}: No LLM API key configured]`;
  }

  // Cap interpolated prompt / stage output (plan Task 5 — runaway context defense)
  const STAGE_PROMPT_MAX = 100_000;
  const STAGE_OUTPUT_MAX = 200_000;

  // Interpolate {{key}} placeholders in prompt (null-byte reject; newlines allowed)
  let prompt: string;
  if (typeof stage.prompt === 'string' && !/\0/.test(stage.prompt) && stage.prompt.trim()) {
    prompt = stage.prompt.trim();
  } else {
    prompt = `Perform the ${stageName} step.`;
  }
  for (const [key, val] of Object.entries(previousOutputs)) {
    // Only interpolate safe placeholder keys (alnum/_/-)
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
    prompt = prompt.replaceAll(`{{${key}}}`, val);
  }
  for (const [key, val] of Object.entries(context)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
    prompt = prompt.replaceAll(`{{${key}}}`, String(val));
  }
  if (prompt.length > STAGE_PROMPT_MAX) {
    prompt = prompt.slice(0, STAGE_PROMPT_MAX) + '\n…[prompt truncated]';
  }

  const clampOutput = (text: string): string =>
    text.length > STAGE_OUTPUT_MAX
      ? text.slice(0, STAGE_OUTPUT_MAX) + '\n…[output truncated]'
      : text;

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
        const body = await res.text().catch(() => '');
        // Scrub control chars from error bodies (log/UI injection defense)
        const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
        return `[Stage ${stageName}: Anthropic API error ${res.status}${detail ? `: ${detail}` : ''}]`;
      }
      const data = await res.json() as { content?: { text?: string }[] };
      const text = data.content?.[0]?.text;
      return clampOutput(typeof text === 'string' ? text : '');
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
      const body = await res.text().catch(() => '');
      // Scrub control chars from error bodies (log/UI injection defense)
      const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
      return `[Stage ${stageName}: OpenAI API error ${res.status}${detail ? `: ${detail}` : ''}]`;
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    return clampOutput(typeof content === 'string' ? content : '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'LLM request failed';
    return `[Stage ${stageName}: ${msg}]`;
  }
}
