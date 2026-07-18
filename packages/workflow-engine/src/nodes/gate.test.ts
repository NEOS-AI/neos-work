import { describe, expect, it } from 'vitest';
import {
  AndGateNode,
  ORGateNode,
  OrGateNode,
  OutputNode,
  ParallelEndNode,
  ParallelStartNode,
  TriggerNode,
} from './gate.js';
import type { NodeContext } from '../types.js';

function makeCtx(inputs: Record<string, unknown>): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'n1',
    inputs,
    settings: {},
  };
}

describe('gate nodes', () => {
  it('TriggerNode passes inputs through', async () => {
    const node = new TriggerNode();
    const result = await node.execute(makeCtx({ a: 1, b: 'x' }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ a: 1, b: 'x' });
    expect(result.durationMs).toBe(0);
  });

  it('OutputNode merges object inputs', async () => {
    const node = new OutputNode();
    const result = await node.execute(makeCtx({ left: { a: 1 }, right: { b: 2 } }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ a: 1, b: 2 });
  });

  it('OutputNode wraps primitive inputs', async () => {
    const node = new OutputNode();
    const result = await node.execute(makeCtx({ only: 'hello' }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ value: 'hello' });
  });

  it('AndGateNode merges all upstream values', async () => {
    const node = new AndGateNode();
    const result = await node.execute(makeCtx({ x: { ok: true }, y: { n: 3 } }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ ok: true, n: 3 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('OrGateNode returns first input value', async () => {
    const node = new OrGateNode();
    const result = await node.execute(makeCtx({ first: 'A', second: 'B' }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('A');
  });

  it('ParallelStartNode echoes inputs', async () => {
    const node = new ParallelStartNode();
    const inputs = { branch: 'start' };
    const result = await node.execute(makeCtx(inputs));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(inputs);
  });

  it('ParallelEndNode merges branch outputs', async () => {
    const node = new ParallelEndNode();
    const result = await node.execute(makeCtx({ a: { fromA: 1 }, b: { fromB: 2 } }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ fromA: 1, fromB: 2 });
  });

  it('ORGateNode adopts first available branch output', async () => {
    const node = new ORGateNode();
    const result = await node.execute(makeCtx({ fast: { winner: true }, slow: { winner: false } }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ winner: true });
  });
});
