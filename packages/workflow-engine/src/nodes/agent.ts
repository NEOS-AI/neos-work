/**
 * AgentNode — wraps AgentOrchestrator for use in a workflow.
 * Supports optional harness injection for domain-specific agent configuration.
 * Supports CLI providers: 'cli-claude', 'cli-gemini', 'cli-codex'.
 */

import { AgentOrchestrator, AnthropicAdapter, GoogleAdapter, OpenAIAdapter, ToolRegistry, createWebSearchTool, createFilesystemTools } from '@neos-work/core';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveHarness } from '../harness/index.js';
import { safeServerUrl } from './server-url.js';


function buildAdapter(settings: Record<string, string>) {
  const provider = String(settings['llmProvider'] ?? 'anthropic').trim().toLowerCase() || 'anthropic';

  if (provider === 'openai') {
    const apiKey = String(settings['OPENAI_API_KEY'] ?? '').trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    const baseUrl = String(settings['OPENAI_BASE_URL'] ?? '').trim() || undefined;
    return new OpenAIAdapter({ provider: 'openai', apiKey, baseUrl });
  }

  if (provider === 'ollama') {
    const baseUrl = String(settings['OLLAMA_BASE_URL'] ?? '').trim() || undefined;
    return new OpenAIAdapter({ provider: 'ollama', baseUrl });
  }

  if (provider === 'google') {
    const apiKey = String(settings['GOOGLE_API_KEY'] ?? '').trim();
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not configured');
    }
    return new GoogleAdapter(apiKey);
  }

  const apiKey = String(settings['ANTHROPIC_API_KEY'] ?? '').trim();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new AnthropicAdapter(apiKey);
}

/** Cap injected memory context so runaway exports cannot bloat the system prompt. */
const MEMORY_CONTEXT_MAX_CHARS = 32_000;
/** Cap Design System DESIGN.md injection (plan Task 1). */
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

function buildToolRegistry(
  allowedTools?: string[],
  settings?: Record<string, string>,
): ToolRegistry {
  const registry = new ToolRegistry();

  const allTools = [
    createWebSearchTool(),
    ...createFilesystemTools(process.cwd()),
  ];

  for (const tool of allTools) {
    if (!allowedTools || allowedTools.includes(tool.name)) {
      registry.register(tool);
    }
  }

  return registry;
}

export class AgentNode implements ExecutableNode {
  constructor(
    public type: 'agent_finance' | 'agent_coding',
    private nodeConfig?: Record<string, unknown>,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();

    const rawHarnessId = this.nodeConfig?.['harnessId'];
    const harnessId =
      typeof rawHarnessId === 'string' ? rawHarnessId.trim()
        : rawHarnessId != null && rawHarnessId !== '' ? String(rawHarnessId).trim()
          : '';
    const harness = harnessId ? resolveHarness(harnessId) : undefined;

    let nodeSystemPrompt =
      typeof this.nodeConfig?.['systemPrompt'] === 'string'
        ? this.nodeConfig['systemPrompt'].trim()
        : String(this.nodeConfig?.['systemPrompt'] ?? '').trim();
    if (nodeSystemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
      nodeSystemPrompt = nodeSystemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
    }
    let harnessPrompt =
      typeof harness?.systemPrompt === 'string' ? harness.systemPrompt.trim() : '';
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
    const authToken = String(
      ctx.settings['AUTH_TOKEN'] ?? ctx.settings['SERVER_TOKEN'] ?? '',
    ).trim();
    let systemPrompt = await buildSystemPromptWithMemory(baseSystemPrompt, serverUrl, authToken);

    // Prepend Design System context if injected (skip whitespace-only payloads; cap size)
    let designCtx =
      typeof ctx.designSystemContent === 'string' ? ctx.designSystemContent.trim() : '';
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
    const toolFilter = harness?.allowedTools
      ?.map((t) => String(t).trim())
      .filter(Boolean);

    // CLI provider branch (accept either `provider` or `llmProvider` from NodeConfig)
    const rawProvider = this.nodeConfig?.['provider'] ?? this.nodeConfig?.['llmProvider'];
    const provider =
      typeof rawProvider === 'string' ? rawProvider.trim().toLowerCase() : '';
    if (provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex') {
      if (!ctx.cliSpawn) {
        return { ok: false, output: null, error: 'CLI spawn not available in this environment', durationMs: Date.now() - start };
      }
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
          (chunk, accumulated) => ctx.onProgress?.(chunk, accumulated),
          ctx.signal,
        );
        return {
          ok: result.exitCode === 0,
          output: result.output,
          error: result.exitCode !== 0 ? `CLI exited with code ${result.exitCode}` : undefined,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        let msg = err instanceof Error ? err.message : String(err);
        if (msg.length > 4_000) msg = msg.slice(0, 4_000);
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
      const nodeProviderRaw = this.nodeConfig?.['llmProvider'] ?? this.nodeConfig?.['provider'];
      const nodeProvider =
        typeof nodeProviderRaw === 'string' ? nodeProviderRaw.trim().toLowerCase() : '';
      const adapterSettings =
        nodeProvider && !nodeProvider.startsWith('cli-')
          ? { ...ctx.settings, llmProvider: nodeProvider }
          : ctx.settings;
      const adapter = buildAdapter(adapterSettings);
      const toolRegistry = buildToolRegistry(toolFilter, ctx.settings);
      // Prefer NodeConfig `llmModel` (panel field), then legacy `model`, then settings defaults
      const rawModel =
        (typeof this.nodeConfig?.['llmModel'] === 'string' && this.nodeConfig['llmModel'].trim())
        || (typeof this.nodeConfig?.['model'] === 'string' && this.nodeConfig['model'].trim())
        || (typeof ctx.settings['model'] === 'string' && ctx.settings['model'].trim())
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

      let lastText = '';
      for await (const event of orchestrator.run(goal, ctx.signal)) {
        if (event.type === 'text') {
          const chunk = typeof event.content === 'string' ? event.content : String(event.content ?? '');
          if (lastText.length < AGENT_STREAM_TEXT_MAX_CHARS) {
            const room = AGENT_STREAM_TEXT_MAX_CHARS - lastText.length;
            lastText += chunk.length > room ? chunk.slice(0, room) : chunk;
          }
          ctx.onProgress?.(chunk, lastText);
        }
        if (event.type === 'done') {
          let result = lastText || JSON.stringify(event.task.steps.at(-1)?.output ?? null);
          if (typeof result === 'string' && result.length > AGENT_STREAM_TEXT_MAX_CHARS) {
            result = result.slice(0, AGENT_STREAM_TEXT_MAX_CHARS);
          }
          return { ok: true, output: result, durationMs: Date.now() - start };
        }
        if (event.type === 'error') {
          let errMsg = typeof event.error === 'string' ? event.error : String(event.error ?? 'Agent error');
          if (errMsg.length > 4_000) errMsg = errMsg.slice(0, 4_000);
          return { ok: false, output: null, error: errMsg, durationMs: Date.now() - start };
        }
      }

      return { ok: true, output: lastText, durationMs: Date.now() - start };
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (msg.length > 4_000) msg = msg.slice(0, 4_000);
      return {
        ok: false,
        output: null,
        error: msg,
        durationMs: Date.now() - start,
      };
    }
  }
}

