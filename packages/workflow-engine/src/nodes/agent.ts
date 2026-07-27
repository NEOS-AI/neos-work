/**
 * AgentNode — domain worker execution for workflow graphs (v0.4 Task 5).
 *
 * - Canonical type: `agent` (legacy `agent_*` still accepted pre-migrate)
 * - Resolves `workerId` (preferred) / `harnessId`
 * - Non-CLI: AgentOrchestrator + permission/workspace tool registry + worker.* events
 * - CLI solo: cli-* providers via injected `cliSpawn` (+ synthetic worker events)
 */

import {
  AgentOrchestrator,
  AnthropicAdapter,
  GoogleAdapter,
  OpenAIAdapter,
  buildWorkerToolRegistry,
  resolveWorkerWorkspace,
  scrubErrorMessage,
} from '@neos-work/core';
import type { DomainWorker, WorkerMode } from '@neos-work/shared';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
// Namespace import so vitest can spyOn packs.resolveWorker (live binding).
import * as packs from '../packs/index.js';
import { safeServerUrl } from './server-url.js';

/** Cap API keys / auth tokens (header hygiene). */
const API_KEY_MAX = 8_192;

function sanitizeSettingKey(raw: unknown, max = API_KEY_MAX): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw) || raw.length > max) return '';
  return raw.trim();
}

function buildAdapter(settings: Record<string, string>) {
  const providerRaw = String(settings['llmProvider'] ?? 'anthropic');
  const provider =
    /[\0\r\n]/.test(providerRaw) ? 'anthropic' : providerRaw.trim().toLowerCase() || 'anthropic';

  if (provider === 'openai') {
    const apiKey = sanitizeSettingKey(settings['OPENAI_API_KEY']);
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    const baseUrl = sanitizeSettingKey(settings['OPENAI_BASE_URL'], 2_048) || undefined;
    return new OpenAIAdapter({ provider: 'openai', apiKey, baseUrl });
  }

  if (provider === 'ollama') {
    const baseUrl = sanitizeSettingKey(settings['OLLAMA_BASE_URL'], 2_048) || undefined;
    return new OpenAIAdapter({ provider: 'ollama', baseUrl });
  }

  if (provider === 'google') {
    const apiKey = sanitizeSettingKey(settings['GOOGLE_API_KEY']);
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured');
    }
    return new GoogleAdapter(apiKey);
  }

  const apiKey = sanitizeSettingKey(settings['ANTHROPIC_API_KEY']);
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new AnthropicAdapter(apiKey);
}

/** Cap injected memory context so runaway exports cannot bloat the system prompt. */
const MEMORY_CONTEXT_MAX_CHARS = 32_000;
/** Cap Design System DESIGN.md injection. */
const DESIGN_CONTEXT_MAX_CHARS = 32_000;
/** Cap node/harness system prompts before memory/design injection. */
const SYSTEM_PROMPT_MAX_CHARS = 100_000;
/** Cap serialized agent inputs passed to CLI spawn / orchestrator goal. */
const CLI_INPUTS_MAX_CHARS = 256 * 1024;
/** Cap streamed agent text accumulated during a single node run. */
const AGENT_STREAM_TEXT_MAX_CHARS = 2 * 1024 * 1024;

async function buildSystemPromptWithMemory(
  basePrompt: string,
  serverUrl: string,
  authToken: string,
): Promise<string> {
  try {
    const res = await fetch(`${serverUrl}/api/memory/export`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return basePrompt;
    let memoryContext = await res.text();
    // Null-byte memory export skipped (prompt/header injection defense)
    if (/\0/.test(memoryContext)) return basePrompt;
    if (!memoryContext.trim()) return basePrompt;
    if (memoryContext.length > MEMORY_CONTEXT_MAX_CHARS) {
      memoryContext =
        memoryContext.slice(0, MEMORY_CONTEXT_MAX_CHARS) +
        '\n\n…[memory truncated]';
    }
    return `${basePrompt}\n\n---\n## Agent Memory\n${memoryContext}`;
  } catch {
    return basePrompt;
  }
}

/**
 * Build a permission/workspace-scoped tool registry for the agent node.
 * Falls back to a full-profile worker rooted at process.cwd when no worker is set.
 */
async function buildAgentToolRegistry(
  worker: DomainWorker | undefined,
  allowedTools: string[] | undefined,
  ctx: NodeContext,
): Promise<{ registry: ReturnType<typeof buildWorkerToolRegistry>; workspaceRoot: string }> {
  const effective: DomainWorker = worker
    ? {
        ...worker,
        allowedTools:
          worker.allowedTools && worker.allowedTools.length > 0
            ? worker.allowedTools
            : allowedTools,
      }
    : {
        id: 'ad_hoc_agent',
        name: 'Agent',
        domain: 'general',
        description: '',
        systemPrompt: '',
        permissionProfile: 'full',
        workspace: { kind: 'none' },
        allowedTools,
      };

  // Control-char / blank run ids → settings fallback or stable default
  const runId =
    typeof ctx.runId === 'string' && ctx.runId.trim() && !/[\0\r\n]/.test(ctx.runId)
      ? ctx.runId.trim()
      : typeof ctx.settings['RUN_ID'] === 'string'
          && ctx.settings['RUN_ID'].trim()
          && !/[\0\r\n]/.test(ctx.settings['RUN_ID'])
        ? ctx.settings['RUN_ID'].trim()
        : 'agent-node';

  // Unique per graph node so parallel same-worker nodes do not share isolated dirs
  const nodeSeg =
    typeof ctx.nodeId === 'string' && ctx.nodeId.trim() && !/[\0\r\n]/.test(ctx.nodeId)
      ? ctx.nodeId.trim()
      : 'agent';
  const workerRunSeg = `${nodeSeg}_${effective.id}`;

  const workspaceRoot = await resolveWorkerWorkspace({
    policy: effective.workspace ?? { kind: 'none' },
    runId,
    workerRunId: workerRunSeg,
  });

  return {
    registry: buildWorkerToolRegistry({
      worker: effective,
      workspaceRoot,
      mode: effective.defaultMode,
    }),
    workspaceRoot,
  };
}

/** Resolve solo/coordinator mode from node config or worker default. */
function resolveMode(config: Record<string, unknown> | undefined, worker?: DomainWorker): WorkerMode {
  const raw = config?.['mode'];
  if (raw === 'solo' || raw === 'coordinator') return raw;
  return worker?.defaultMode ?? 'solo';
}

function emitWorkerEvent(
  ctx: NodeContext,
  event: {
    type: 'worker.started' | 'worker.progress' | 'worker.completed' | 'worker.failed';
    workerId: string;
    workerRunId: string;
    chunk?: string;
    output?: unknown;
    error?: string;
  },
): void {
  try {
    ctx.onWorkerEvent?.(event);
  } catch {
    // Host handlers must not break the node
  }
}

export class AgentNode implements ExecutableNode {
  constructor(
    /** v2 canonical: `agent`. Legacy `agent_*` kept for pre-migrate graphs. */
    public type: 'agent' | 'agent_finance' | 'agent_coding',
    private nodeConfig?: Record<string, unknown>,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();

    // v2 workerId preferred; harnessId accepted until full migrate (BC-4)
    const rawWorkerId = this.nodeConfig?.['workerId'] ?? this.nodeConfig?.['harnessId'];
    let harnessId = '';
    if (typeof rawWorkerId === 'string') {
      // Control-char / overlong → ignore worker (resolveWorker also guards)
      if (!/[\0\r\n]/.test(rawWorkerId) && rawWorkerId.length <= 200) {
        harnessId = rawWorkerId.trim();
      }
    } else if (rawWorkerId != null && rawWorkerId !== '') {
      const s = String(rawWorkerId);
      if (!/[\0\r\n]/.test(s) && s.length <= 200) harnessId = s.trim();
    }
    const harness = harnessId ? packs.resolveWorker(harnessId) : undefined;
    const workerId = harness?.id ?? 'ad_hoc_agent';
    const workerRunId = crypto.randomUUID();
    const workerMode = resolveMode(this.nodeConfig, harness);

    const sysRaw =
      typeof this.nodeConfig?.['systemPrompt'] === 'string'
        ? this.nodeConfig['systemPrompt']
        : String(this.nodeConfig?.['systemPrompt'] ?? '');
    // Strip null bytes; allow newlines in multi-line system prompts
    let nodeSystemPrompt = /\0/.test(sysRaw) ? sysRaw.replace(/\0/g, '') : sysRaw;
    nodeSystemPrompt = nodeSystemPrompt.trim();
    if (nodeSystemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      nodeSystemPrompt = nodeSystemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
    }
    // Null-byte strip on harness prompt (multi-line OK)
    let harnessPrompt = '';
    if (typeof harness?.systemPrompt === 'string') {
      const hp = /\0/.test(harness.systemPrompt)
        ? harness.systemPrompt.replace(/\0/g, '')
        : harness.systemPrompt;
      harnessPrompt = hp.trim();
    }
    if (harnessPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      harnessPrompt = harnessPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
    }
    let baseSystemPrompt = harnessPrompt
      ? [harnessPrompt, nodeSystemPrompt].filter(Boolean).join('\n\n---\n')
      : nodeSystemPrompt;
    if (baseSystemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      baseSystemPrompt = baseSystemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
    }

    const serverUrl = safeServerUrl(ctx.settings['SERVER_URL'], 'http://localhost:3579');
    // Prefer AUTH_TOKEN; fall back to SERVER_TOKEN (Media/Deploy share the runtime token)
    const authToken =
      sanitizeSettingKey(ctx.settings['AUTH_TOKEN'])
      || sanitizeSettingKey(ctx.settings['SERVER_TOKEN'])
      || '';
    let systemPrompt = await buildSystemPromptWithMemory(baseSystemPrompt, serverUrl, authToken);

    // Prepend Design System context if injected (skip whitespace-only / null-byte payloads; cap size)
    let designCtx = '';
    if (typeof ctx.designSystemContent === 'string' && !/\0/.test(ctx.designSystemContent)) {
      designCtx = ctx.designSystemContent.trim();
    }
    if (designCtx) {
      if (designCtx.length > DESIGN_CONTEXT_MAX_CHARS) {
        designCtx =
          designCtx.slice(0, DESIGN_CONTEXT_MAX_CHARS) +
          '\n\n…[design context truncated]';
      }
      systemPrompt = `<!-- DESIGN CONTEXT -->\n${designCtx}\n<!-- /DESIGN CONTEXT -->\n\n${systemPrompt}`;
    }

    // Prefer harness constraint; else node config (both clamped 1–200 to match editor validation)
    const fromConfig = Number(this.nodeConfig?.['maxSteps'] ?? 20);
    const configSteps =
      Number.isFinite(fromConfig) && fromConfig >= 1
        ? Math.min(200, Math.floor(fromConfig))
        : 20;
    const rawHarnessSteps = Number(harness?.constraints?.maxSteps);
    const harnessSteps =
      Number.isFinite(rawHarnessSteps) && rawHarnessSteps >= 1
        ? Math.min(200, Math.floor(rawHarnessSteps))
        : undefined;
    const maxIterations = harnessSteps ?? configSteps;
    // Control-char tool names dropped before trim (align with harness DB normalize)
    const toolFilter = harness?.allowedTools
      ?.map((t) => String(t ?? ''))
      .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
      .map((t) => t.trim())
      .filter(Boolean);

    // CLI provider branch (accept either `provider` or `llmProvider` from NodeConfig)
    const rawProvider = this.nodeConfig?.['provider'] ?? this.nodeConfig?.['llmProvider'];
    let provider = '';
    if (typeof rawProvider === 'string' && !/[\0\r\n]/.test(rawProvider)) {
      provider = rawProvider.trim().toLowerCase();
    }
    if (provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex') {
      if (!ctx.cliSpawn) {
        return {
          ok: false,
          output: null,
          error: 'CLI spawn not available in this environment',
          durationMs: Date.now() - start,
        };
      }
      emitWorkerEvent(ctx, { type: 'worker.started', workerId, workerRunId });
      try {
        let inputsJson = JSON.stringify(ctx.inputs ?? {});
        if (inputsJson.length > CLI_INPUTS_MAX_CHARS) {
          inputsJson =
            inputsJson.slice(0, CLI_INPUTS_MAX_CHARS) + '…[inputs truncated]';
        }
        let prompt = systemPrompt
          ? `${systemPrompt}\n\n---\n${inputsJson}`
          : inputsJson;
        // CLI spawn already caps output; keep prompt bounded too
        if (prompt.length > SYSTEM_PROMPT_MAX_CHARS + CLI_INPUTS_MAX_CHARS) {
          prompt = prompt.slice(0, SYSTEM_PROMPT_MAX_CHARS + CLI_INPUTS_MAX_CHARS);
        }
        const result = await ctx.cliSpawn(
          provider,
          prompt,
          (chunk, accumulated) => {
            ctx.onProgress?.(chunk, accumulated);
            emitWorkerEvent(ctx, {
              type: 'worker.progress',
              workerId,
              workerRunId,
              chunk,
            });
          },
          ctx.signal,
        );
        const durationMs = Date.now() - start;
        if (result.exitCode === 0) {
          emitWorkerEvent(ctx, {
            type: 'worker.completed',
            workerId,
            workerRunId,
            output: result.output,
          });
          return { ok: true, output: result.output, durationMs };
        }
        const error = `CLI exited with code ${result.exitCode}`;
        emitWorkerEvent(ctx, { type: 'worker.failed', workerId, workerRunId, error });
        return {
          ok: false,
          output: result.output,
          error,
          durationMs,
        };
      } catch (err) {
        const msg =
          scrubErrorMessage(err instanceof Error ? err.message : String(err), 4_000)
          || 'Operation failed';
        emitWorkerEvent(ctx, { type: 'worker.failed', workerId, workerRunId, error: msg });
        return {
          ok: false,
          output: null,
          error: msg,
          durationMs: Date.now() - start,
        };
      }
    }

    try {
      // Prefer node-level llmProvider (NodeConfigPanel), then execution settings
      // Control-char before trim so leading \n cannot strip to a known provider
      const nodeProviderRaw = this.nodeConfig?.['llmProvider'] ?? this.nodeConfig?.['provider'];
      const nodeProvider =
        typeof nodeProviderRaw === 'string' && !/[\0\r\n]/.test(nodeProviderRaw)
          ? nodeProviderRaw.trim().toLowerCase()
          : '';
      const adapterSettings =
        nodeProvider && !nodeProvider.startsWith('cli-')
          ? { ...ctx.settings, llmProvider: nodeProvider }
          : ctx.settings;
      const adapter = buildAdapter(adapterSettings);
      // Permission profile + workspace isolation via WorkerRuntime helpers (Task 4)
      const { registry: toolRegistry } = await buildAgentToolRegistry(
        harness
          ? { ...harness, defaultMode: workerMode }
          : undefined,
        toolFilter,
        ctx,
      );
      // Prefer NodeConfig `llmModel` (panel field), then legacy `model`, then settings defaults
      // Control-char model ids are ignored (check before trim)
      const pickModel = (raw: unknown): string => {
        if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
        return raw.trim();
      };
      const rawModel =
        pickModel(this.nodeConfig?.['llmModel'])
        || pickModel(this.nodeConfig?.['model'])
        || pickModel(ctx.settings['model'])
        || '';
      const model = rawModel || undefined;
      const orchestrator = new AgentOrchestrator(adapter, toolRegistry, {
        maxIterations,
        model,
      });

      let inputsJson = JSON.stringify(ctx.inputs ?? {});
      if (inputsJson.length > CLI_INPUTS_MAX_CHARS) {
        inputsJson =
          inputsJson.slice(0, CLI_INPUTS_MAX_CHARS) + '…[inputs truncated]';
      }
      const goal = systemPrompt
        ? `${systemPrompt}\n\n---\n${inputsJson}`
        : inputsJson;

      emitWorkerEvent(ctx, { type: 'worker.started', workerId, workerRunId });

      let lastText = '';
      for await (const event of orchestrator.run(goal, ctx.signal)) {
        if (event.type === 'text') {
          const chunk = typeof event.content === 'string' ? event.content : String(event.content ?? '');
          if (lastText.length < AGENT_STREAM_TEXT_MAX_CHARS) {
            const room = AGENT_STREAM_TEXT_MAX_CHARS - lastText.length;
            lastText += chunk.length > room ? chunk.slice(0, room) : chunk;
          }
          ctx.onProgress?.(chunk, lastText);
          emitWorkerEvent(ctx, {
            type: 'worker.progress',
            workerId,
            workerRunId,
            chunk,
          });
        }
        if (event.type === 'done') {
          let result = lastText || JSON.stringify(event.task.steps.at(-1)?.output ?? null);
          if (typeof result === 'string' && result.length > AGENT_STREAM_TEXT_MAX_CHARS) {
            result = result.slice(0, AGENT_STREAM_TEXT_MAX_CHARS);
          }
          emitWorkerEvent(ctx, {
            type: 'worker.completed',
            workerId,
            workerRunId,
            output: result,
          });
          return { ok: true, output: result, durationMs: Date.now() - start };
        }
        if (event.type === 'error') {
          const errMsg =
            scrubErrorMessage(
              typeof event.error === 'string' ? event.error : String(event.error ?? 'Agent error'),
              4_000,
            ) || 'Agent error';
          emitWorkerEvent(ctx, {
            type: 'worker.failed',
            workerId,
            workerRunId,
            error: errMsg,
          });
          return { ok: false, output: null, error: errMsg, durationMs: Date.now() - start };
        }
      }

      emitWorkerEvent(ctx, {
        type: 'worker.completed',
        workerId,
        workerRunId,
        output: lastText,
      });
      return { ok: true, output: lastText, durationMs: Date.now() - start };
    } catch (err) {
      const msg =
        scrubErrorMessage(err instanceof Error ? err.message : String(err), 4_000)
        || 'Operation failed';
      emitWorkerEvent(ctx, {
        type: 'worker.failed',
        workerId,
        workerRunId,
        error: msg,
      });
      return {
        ok: false,
        output: null,
        error: msg,
        durationMs: Date.now() - start,
      };
    }
  }
}
