/**
 * BlockNode — executes a domain block (native / prompt / skill).
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { resolveBlock, getNativeExecutor } from '../blocks/registry.js';

// Input length limit for prompt injection protection
const MAX_INPUT_LENGTH = 4096;

export class BlockNode implements ExecutableNode {
  type = 'block' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const blockId = ctx.config?.['blockId'] as string | undefined;
    if (!blockId) {
      return { ok: false, output: null, error: 'blockId is required for block nodes', durationMs: 0 };
    }

    const block = resolveBlock(blockId);
    if (!block) {
      return { ok: false, output: null, error: `Block not found: ${blockId}`, durationMs: 0 };
    }

    const params = (ctx.config?.['params'] as Record<string, unknown>) ?? {};

    if (block.implementationType === 'native') {
      const executor = getNativeExecutor(blockId);
      if (!executor) {
        return {
          ok: false,
          output: null,
          error: `Native executor not found: ${blockId}`,
          durationMs: Date.now() - start,
        };
      }

      const result = await executor.execute({
        params,
        inputs: ctx.inputs,
        settings: ctx.settings,
        signal: ctx.signal,
      });

      return {
        ok: result.ok,
        output: result.output,
        error: result.error,
        durationMs: Date.now() - start,
      };
    }

    if (block.implementationType === 'prompt') {
      // Sanitize inputs length before injecting into prompt (prompt injection protection)
      const inputsStr = JSON.stringify(ctx.inputs).slice(0, MAX_INPUT_LENGTH);
      const prompt = (block.promptTemplate ?? '')
        .replace('{{params}}', JSON.stringify(params))
        .replace('{{inputs}}', inputsStr);

      // Delegate to a simple LLM call — import AgentNode lazily to avoid circular deps
      const { AgentNode } = await import('./agent.js');
      const agentNode = new AgentNode('agent_finance', {
        systemPrompt: prompt,
        maxSteps: 3,
      });
      return agentNode.execute({ ...ctx, inputs: {} });
    }

    if (block.implementationType === 'skill') {
      // Skill-based execution: pass skillId in config and let AgentNode handle it
      const { AgentNode } = await import('./agent.js');
      const agentNode = new AgentNode('agent_finance', {
        systemPrompt: `Use skill: ${block.skillId ?? ''}\n\nInputs: ${JSON.stringify(ctx.inputs).slice(0, MAX_INPUT_LENGTH)}`,
        maxSteps: 10,
      });
      return agentNode.execute({ ...ctx, inputs: {} });
    }

    return {
      ok: false,
      output: null,
      error: `Unknown implementationType: ${block.implementationType}`,
      durationMs: Date.now() - start,
    };
  }
}
