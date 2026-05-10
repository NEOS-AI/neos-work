/**
 * AgentNode — wraps AgentOrchestrator for use in a workflow.
 * Supports optional harness injection for domain-specific agent configuration.
 */

import { AgentOrchestrator, AnthropicAdapter, GoogleAdapter, ToolRegistry, createWebSearchTool, createFilesystemTools } from '@neos-work/core';
import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveHarness } from '../harness/index.js';

function buildAdapter(settings: Record<string, string>) {
  const provider = settings['llmProvider'] ?? 'anthropic';
  if (provider === 'google' && settings['GOOGLE_API_KEY']) {
    return new GoogleAdapter(settings['GOOGLE_API_KEY']);
  }
  const apiKey = settings['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new AnthropicAdapter(apiKey);
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

    const systemPrompt = harness
      ? [harness.systemPrompt, this.nodeConfig?.['systemPrompt']].filter(Boolean).join('\n\n---\n')
      : String(this.nodeConfig?.['systemPrompt'] ?? '');

    const maxIterations = harness?.constraints?.maxSteps ?? Number(this.nodeConfig?.['maxSteps'] ?? 20);
    const toolFilter = harness?.allowedTools;

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
