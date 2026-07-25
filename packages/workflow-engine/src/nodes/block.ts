/**
 * BlockNode — executes a domain block (native / prompt / skill).
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import {
  resolveBlock,
  getNativeExecutor,
  normalizeImplementationType,
} from '../blocks/registry.js';

// Input length limit for prompt injection protection
const MAX_INPUT_LENGTH = 4096;
const BLOCK_ID_MAX = 200;
const PARAM_KEY_MAX = 100;
const PARAM_KEYS_MAX = 100;
/** Cap individual string param values (native block input hygiene). */
const PARAM_VALUE_MAX = 10_000;

export class BlockNode implements ExecutableNode {
  type = 'block' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const rawBlockId = ctx.config?.['blockId'];
    let blockId = '';
    if (typeof rawBlockId === 'string') {
      // Control-char check before trim (trim strips leading/trailing \r\n)
      if (/[\0\r\n]/.test(rawBlockId) || rawBlockId.length > BLOCK_ID_MAX) {
        return { ok: false, output: null, error: 'blockId is invalid', durationMs: 0 };
      }
      blockId = rawBlockId.trim();
    } else if (rawBlockId != null && rawBlockId !== '') {
      const s = String(rawBlockId);
      if (/[\0\r\n]/.test(s) || s.length > BLOCK_ID_MAX) {
        return { ok: false, output: null, error: 'blockId is invalid', durationMs: 0 };
      }
      blockId = s.trim();
    }
    if (!blockId) {
      return { ok: false, output: null, error: 'blockId is required for block nodes', durationMs: 0 };
    }
    if (blockId.length > BLOCK_ID_MAX) {
      return { ok: false, output: null, error: 'blockId is invalid', durationMs: 0 };
    }

    const block = resolveBlock(blockId);
    if (!block) {
      return { ok: false, output: null, error: `Block not found: ${blockId}`, durationMs: 0 };
    }

    // Normalize params: drop blank/control-char/overlong keys; trim string values
    const rawParams =
      ctx.config?.['params'] && typeof ctx.config['params'] === 'object' && !Array.isArray(ctx.config['params'])
        ? (ctx.config['params'] as Record<string, unknown>)
        : {};
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (Object.keys(params).length >= PARAM_KEYS_MAX) break;
      // Control-char check before trim so "\nk" is not accepted as "k"
      if (typeof k !== 'string' || /[\0\r\n]/.test(k) || k.length > PARAM_KEY_MAX) continue;
      const key = k.trim();
      if (!key || key.length > PARAM_KEY_MAX) continue;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        params[key] =
          trimmed.length > PARAM_VALUE_MAX ? trimmed.slice(0, PARAM_VALUE_MAX) : trimmed;
      } else {
        params[key] = v;
      }
    }

    // implementationType is case-insensitive (Native / PROMPT / skill)
    const implType = normalizeImplementationType(block.implementationType);

    if (implType === 'native') {
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

    if (implType === 'prompt') {
      const template =
        typeof block.promptTemplate === 'string' ? block.promptTemplate.trim() : '';
      if (!template) {
        return {
          ok: false,
          output: null,
          error: 'promptTemplate is required for prompt blocks',
          durationMs: Date.now() - start,
        };
      }
      // Sanitize inputs length before injecting into prompt (prompt injection protection)
      const inputsStr = JSON.stringify(ctx.inputs).slice(0, MAX_INPUT_LENGTH);
      const prompt = template
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

    if (implType === 'skill') {
      let skillId =
        typeof block.skillId === 'string' ? block.skillId.trim() : String(block.skillId ?? '').trim();
      if (!skillId) {
        return {
          ok: false,
          output: null,
          error: 'skillId is required for skill blocks',
          durationMs: Date.now() - start,
        };
      }
      if (/[\0\r\n]/.test(skillId) || skillId.length > BLOCK_ID_MAX) {
        return {
          ok: false,
          output: null,
          error: 'skillId is invalid',
          durationMs: Date.now() - start,
        };
      }
      // Skill-based execution: pass skillId in config and let AgentNode handle it
      const { AgentNode } = await import('./agent.js');
      const agentNode = new AgentNode('agent_finance', {
        systemPrompt: `Use skill: ${skillId}\n\nInputs: ${JSON.stringify(ctx.inputs).slice(0, MAX_INPUT_LENGTH)}`,
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
