/**
 * AgentNode — wraps AgentOrchestrator for use in a workflow.
 * Supports optional harness injection for domain-specific agent configuration.
 * Supports CLI providers: 'cli-claude', 'cli-gemini', 'cli-codex'.
 */

import { AgentOrchestrator, AnthropicAdapter, GoogleAdapter, OpenAIAdapter, ToolRegistry, createWebSearchTool, createFilesystemTools } from '@neos-work/core';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveHarness } from '../harness/index.js';

function buildAdapter(settings: Record<string, string>) {
  const provider = settings['llmProvider'] ?? 'anthropic';

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
    const memoryContext = await res.text();
    if (!memoryContext.trim()) return basePrompt;
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

    const baseSystemPrompt = harness
      ? [harness.systemPrompt, this.nodeConfig?.['systemPrompt']].filter(Boolean).join('\n\n---\n')
      : String(this.nodeConfig?.['systemPrompt'] ?? '');

    const serverUrl = String(ctx.settings['SERVER_URL'] ?? 'http://localhost:3579').trim()
      || 'http://localhost:3579';
    const authToken = String(ctx.settings['AUTH_TOKEN'] ?? '').trim();
    let systemPrompt = await buildSystemPromptWithMemory(baseSystemPrompt, serverUrl, authToken);

    // Prepend Design System context if injected (skip whitespace-only payloads)
    const designCtx =
      typeof ctx.designSystemContent === 'string' ? ctx.designSystemContent.trim() : '';
    if (designCtx) {
      systemPrompt = `<!-- DESIGN CONTEXT -->\n${designCtx}\n<!-- /DESIGN CONTEXT -->\n\n${systemPrompt}`;
    }

    // Prefer harness constraint; else node config (clamped 1–200 to match editor validation)
    const fromConfig = Number(this.nodeConfig?.['maxSteps'] ?? 20);
    const configSteps =
      Number.isFinite(fromConfig) && fromConfig >= 1
        ? Math.min(200, Math.floor(fromConfig))
        : 20;
    const maxIterations = harness?.constraints?.maxSteps ?? configSteps;
    const toolFilter = harness?.allowedTools;

    // CLI provider branch (accept either `provider` or `llmProvider` from NodeConfig)
    const provider = (this.nodeConfig?.['provider'] ?? this.nodeConfig?.['llmProvider']) as string | undefined;
    if (provider === 'cli-claude' || provider === 'cli-gemini' || provider === 'cli-codex') {
      if (!ctx.cliSpawn) {
        return { ok: false, output: null, error: 'CLI spawn not available in this environment', durationMs: Date.now() - start };
      }
      const prompt = systemPrompt
        ? `${systemPrompt}\n\n---\n${JSON.stringify(ctx.inputs)}`
        : JSON.stringify(ctx.inputs);
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
    }

    try {
      // Prefer node-level llmProvider (NodeConfigPanel), then execution settings
      const nodeProvider = (this.nodeConfig?.['llmProvider'] ?? this.nodeConfig?.['provider']) as
        | string
        | undefined;
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

      const goal = systemPrompt
        ? `${systemPrompt}\n\n---\n${JSON.stringify(ctx.inputs)}`
        : JSON.stringify(ctx.inputs);

      let lastText = '';
      for await (const event of orchestrator.run(goal, ctx.signal)) {
        if (event.type === 'text') {
          lastText += event.content;
          ctx.onProgress?.(event.content, lastText);
        }
        if (event.type === 'done') {
          const result = lastText || JSON.stringify(event.task.steps.at(-1)?.output ?? null);
          return { ok: true, output: result, durationMs: Date.now() - start };
        }
        if (event.type === 'error') {
          return { ok: false, output: null, error: event.error, durationMs: Date.now() - start };
        }
      }

      return { ok: true, output: lastText, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}

