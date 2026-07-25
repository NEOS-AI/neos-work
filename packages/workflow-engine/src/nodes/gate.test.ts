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

  it('TriggerNode caps input key count at 200', async () => {
    const fat: Record<string, unknown> = {};
    for (let i = 0; i < 250; i++) fat[`k${i}`] = i;
    const result = await new TriggerNode().execute(makeCtx(fat));
    expect(result.ok).toBe(true);
    expect(Object.keys(result.output as object).length).toBe(200);
  });

  it('TriggerNode drops control-char keys before trim', async () => {
    const result = await new TriggerNode().execute(
      makeCtx({ good: 1, 'bad\nkey': 2, '\nlead': 3 }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ good: 1 });
  });

  it('OutputNode truncates oversized merged JSON', async () => {
    const fat = { blob: 'x'.repeat(1_100_000) };
    const result = await new OutputNode().execute(makeCtx({ a: fat }));
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ truncated: true });
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

  it('OrGateNode and ORGateNode fail when no upstream inputs', async () => {
    const legacy = await new OrGateNode().execute(makeCtx({}));
    expect(legacy.ok).toBe(false);
    expect(legacy.error).toMatch(/no upstream/i);

    const modern = await new ORGateNode().execute(makeCtx({}));
    expect(modern.ok).toBe(false);
    expect(modern.error).toMatch(/no upstream/i);
  });

  it('AndGateNode and ParallelEndNode fail when no upstream inputs', async () => {
    const and = await new AndGateNode().execute(makeCtx({}));
    expect(and.ok).toBe(false);
    expect(and.error).toMatch(/no upstream/i);

    const pe = await new ParallelEndNode().execute(makeCtx({}));
    expect(pe.ok).toBe(false);
    expect(pe.error).toMatch(/no upstream|branch/i);
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

  it('ParallelEndNode wraps primitive branch outputs', async () => {
    const node = new ParallelEndNode();
    const result = await node.execute(makeCtx({ a: 'text', b: 3 }));
    expect(result.ok).toBe(true);
    // last merge wins for { value } keys
    expect(result.output).toEqual({ value: 3 });
  });

  it('exposes stable type identifiers', () => {
    expect(new TriggerNode().type).toBe('trigger');
    expect(new OutputNode().type).toBe('output');
    expect(new AndGateNode().type).toBe('gate_and');
    expect(new OrGateNode().type).toBe('gate_or');
    expect(new ParallelStartNode().type).toBe('parallel_start');
    expect(new ParallelEndNode().type).toBe('parallel_end');
    expect(new ORGateNode().type).toBe('or_gate');
  });

  it('TriggerNode caps input keys and OutputNode truncates oversized merges', async () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 250; i++) many[`k${i}`] = i;
    const trigger = await new TriggerNode().execute(makeCtx(many));
    expect(trigger.ok).toBe(true);
    expect(Object.keys(trigger.output as object).length).toBe(200);

    // Unique keys so Object.assign does not collapse to one short payload field
    const fat: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) fat[`b${i}`] = { [`p${i}`]: 'x'.repeat(20_000) };
    const out = await new OutputNode().execute(makeCtx(fat));
    expect(out.ok).toBe(true);
    expect(out.output).toMatchObject({ truncated: true });
  });
});

