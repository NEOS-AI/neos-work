/**
 * Gate and control-flow nodes:
 * - TriggerNode: workflow entry point, passes inputs through
 * - OutputNode: merges all upstream outputs
 * - AndGateNode: passes when all upstream inputs are ready
 * - OrGateNode: passes on first available upstream input
 * - ParallelStartNode: marks the start of parallel branches (fan-out)
 * - ParallelEndNode: merges all parallel branch outputs (fan-in)
 * - ORGateNode: passes on first completed branch (OR semantics, new)
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

/** Cap gate merge output JSON so runaway fan-in cannot bloat node_results. */
const GATE_OUTPUT_MAX_CHARS = 1_048_576;

function mergeInputs(inputs: Record<string, unknown> | undefined): unknown {
  const values = Object.values(inputs ?? {}).slice(0, 200);
  const merged = Object.assign(
    {},
    ...values.map((v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : { value: v })),
  );
  try {
    const json = JSON.stringify(merged);
    if (json.length > GATE_OUTPUT_MAX_CHARS) {
      return { truncated: true, preview: json.slice(0, 256) };
    }
  } catch {
    return { truncated: true, preview: '[unserializable]' };
  }
  return merged;
}

export class TriggerNode implements ExecutableNode {
  type = 'trigger' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    // Cap trigger payload keys; drop control-char keys (runtime parameterisation hygiene)
    const inputs = ctx.inputs ?? {};
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (Object.keys(clean).length >= 200) break;
      if (typeof k !== 'string' || /[\0\r\n]/.test(k)) continue;
      const key = k.trim();
      if (!key || key.length > 200) continue;
      clean[key] = v;
    }
    return { ok: true, output: clean, durationMs: 0 };
  }
}

export class OutputNode implements ExecutableNode {
  type = 'output' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    return { ok: true, output: mergeInputs(ctx.inputs as Record<string, unknown>), durationMs: 0 };
  }
}

export class AndGateNode implements ExecutableNode {
  type = 'gate_and' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const values = Object.values(ctx.inputs ?? {});
    if (values.length === 0) {
      return {
        ok: false,
        output: null,
        error: 'AND gate: no upstream inputs',
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      output: mergeInputs(ctx.inputs as Record<string, unknown>),
      durationMs: Date.now() - start,
    };
  }
}

export class OrGateNode implements ExecutableNode {
  type = 'gate_or' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const values = Object.values(ctx.inputs ?? {});
    if (values.length === 0) {
      return {
        ok: false,
        output: null,
        error: 'OR gate: no upstream inputs',
        durationMs: Date.now() - start,
      };
    }
    const firstInput = values[0];
    return { ok: true, output: firstInput, durationMs: Date.now() - start };
  }
}

/** Marks the start of parallel fan-out branches. Passes all inputs through. */
export class ParallelStartNode implements ExecutableNode {
  type = 'parallel_start' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    return { ok: true, output: ctx.inputs, durationMs: Date.now() - start };
  }
}

/** Merges all parallel branch outputs (fan-in). Combines all upstream outputs. */
export class ParallelEndNode implements ExecutableNode {
  type = 'parallel_end' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const values = Object.values(ctx.inputs ?? {});
    if (values.length === 0) {
      return {
        ok: false,
        output: null,
        error: 'Parallel end: no upstream branch inputs',
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      output: mergeInputs(ctx.inputs as Record<string, unknown>),
      durationMs: Date.now() - start,
    };
  }
}

/** OR gate: adopts the output of whichever branch completes first. */
export class ORGateNode implements ExecutableNode {
  type = 'or_gate' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const values = Object.values(ctx.inputs ?? {});
    if (values.length === 0) {
      return {
        ok: false,
        output: null,
        error: 'OR gate: no upstream inputs',
        durationMs: Date.now() - start,
      };
    }
    const firstInput = values[0];
    return { ok: true, output: firstInput, durationMs: Date.now() - start };
  }
}
