/**
 * AgentNode — wraps AgentOrchestrator for use in a workflow.
 * Supports optional harness injection for domain-specific agent configuration.
 * Supports CLI providers: 'cli-claude', 'cli-gemini', 'cli-codex'.
 */

import { AgentOrchestrator, AnthropicAdapter, GoogleAdapter, OpenAIAdapter, ToolRegistry, createWebSearchTool, createFilesystemTools } from '@neos-work/core';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveHarness } from '../harness/index.js';
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
    let harnessId = '';
    if (typeof rawHarnessId === 'string') {
      // Control-char / overlong → ignore harness (resolveHarness also guards)
      if (!/[\0\r\n]/.test(rawHarnessId) && rawHarnessId.length <= 200) {
        harnessId = rawHarnessId.trim();
      }
    } else if (rawHarnessId != null && rawHarnessId !== '') {
      const s = String(rawHarnessId);
      if (!/[\0\r\n]/.test(s) && s.length <= 200) harnessId = s.trim();
    }
    const harness = harnessId ? resolveHarness(harnessId) : undefined;

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
      const toolRegistry = buildToolRegistry(toolFilter, ctx.settings);
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

