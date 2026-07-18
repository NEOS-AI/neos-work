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
    const apiKey = settings['OPENAI_API_KEY'];
    const baseUrl = settings['OPENAI_BASE_URL'];
    return new OpenAIAdapter({ provider: 'openai', apiKey, baseUrl });
  }

  if (provider === 'ollama') {
    const baseUrl = settings['OLLAMA_BASE_URL'];
    return new OpenAIAdapter({ provider: 'ollama', baseUrl });
  }

  if (provider === 'google' && settings['GOOGLE_API_KEY']) {
    return new GoogleAdapter(settings['GOOGLE_API_KEY']);
  }

  const apiKey = settings['ANTHROPIC_API_KEY'];
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

    const harnessId = this.nodeConfig?.['harnessId'] as string | undefined;
    const harness = harnessId ? resolveHarness(harnessId) : undefined;

    const baseSystemPrompt = harness
      ? [harness.systemPrompt, this.nodeConfig?.['systemPrompt']].filter(Boolean).join('\n\n---\n')
      : String(this.nodeConfig?.['systemPrompt'] ?? '');

    const serverUrl = ctx.settings['SERVER_URL'] ?? 'http://localhost:3579';
    const authToken = ctx.settings['AUTH_TOKEN'] ?? '';
    let systemPrompt = await buildSystemPromptWithMemory(baseSystemPrompt, serverUrl, authToken);

    // Prepend Design System context if injected
    if (ctx.designSystemContent) {
      systemPrompt = `<!-- DESIGN CONTEXT -->\n${ctx.designSystemContent}\n<!-- /DESIGN CONTEXT -->\n\n${systemPrompt}`;
    }

    const maxIterations = harness?.constraints?.maxSteps ?? Number(this.nodeConfig?.['maxSteps'] ?? 20);
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
      const adapter = buildAdapter(ctx.settings);
      const toolRegistry = buildToolRegistry(toolFilter, ctx.settings);
      const orchestrator = new AgentOrchestrator(adapter, toolRegistry, { maxIterations });

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

