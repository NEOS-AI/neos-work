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

export class TriggerNode implements ExecutableNode {
  type = 'trigger' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    return { ok: true, output: ctx.inputs, durationMs: 0 };
  }
}

export class OutputNode implements ExecutableNode {
  type = 'output' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const values = Object.values(ctx.inputs);
    const merged = Object.assign(
      {},
      ...values.map((v) => (typeof v === 'object' && v !== null ? v : { value: v })),
    );
    return { ok: true, output: merged, durationMs: 0 };
  }
}

export class AndGateNode implements ExecutableNode {
  type = 'gate_and' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const values = Object.values(ctx.inputs);
    const merged = Object.assign(
      {},
      ...values.map((v) => (typeof v === 'object' && v !== null ? v : { value: v })),
    );
    return { ok: true, output: merged, durationMs: Date.now() - start };
  }
}

export class OrGateNode implements ExecutableNode {
  type = 'gate_or' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const firstInput = Object.values(ctx.inputs)[0];
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
    const values = Object.values(ctx.inputs);
    const merged = Object.assign(
      {},
      ...values.map((v) => (typeof v === 'object' && v !== null ? v : { value: v })),
    );
    return { ok: true, output: merged, durationMs: Date.now() - start };
  }
}

/** OR gate: adopts the output of whichever branch completes first. */
export class ORGateNode implements ExecutableNode {
  type = 'or_gate' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const firstInput = Object.values(ctx.inputs)[0];
    return { ok: true, output: firstInput, durationMs: Date.now() - start };
  }
}
