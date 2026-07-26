/**
 * Exercises the concurrent or_gate race path by forcing topological order
 * so or_gate is visited before its predecessor branches have run.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowSSEEvent } from '@neos-work/shared';

vi.mock('./graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./graph.js')>();
  return {
    ...actual,
    topologicalSort: (nodes: Workflow['nodes'], _edges: Workflow['edges']) => {
      // Put or_gate first so predecessors are still pending when it runs
      return [...nodes].sort((a, b) => {
        const aOr = a.type === 'or_gate' ? 0 : 1;
        const bOr = b.type === 'or_gate' ? 0 : 1;
        return aOr - bOr;
      });
    },
  };
});

import { executeWorkflow } from './executor.js';
import { registerNativeBlock, registerBlockMeta } from './blocks/registry.js';

function baseWorkflow(overrides: Partial<Workflow>): Workflow {
  return {
    id: 'wf-concurrent',
    name: 'Concurrent OR',
    domain: 'general',
    nodes: [],
    edges: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('executeWorkflow concurrent or_gate race', () => {
  it('races pending predecessor branches and adopts the first winner', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-or-race-win',
      workflow: baseWorkflow({
        nodes: [
          { id: 'b1', type: 'output', label: 'B1', position: { x: 0, y: 0 }, config: {} },
          { id: 'b2', type: 'output', label: 'B2', position: { x: 0, y: 1 }, config: {} },
          { id: 'or', type: 'or_gate', label: 'OR', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'b1', target: 'or' },
          { id: 'e2', source: 'b2', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (e) => events.push(e),
    });

    expect(
      events.some((e) => e.type === 'node.completed' && (e as { nodeId: string }).nodeId === 'or'),
    ).toBe(true);
    // Both branches should have been started via concurrent runNode
    expect(
      events.filter((e) => e.type === 'node.started' && ['b1', 'b2'].includes((e as { nodeId: string }).nodeId))
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
  });

  it('fails or_gate when all concurrent branches fail', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-or-race-fail',
      workflow: baseWorkflow({
        nodes: [
          {
            id: 'b1',
            type: 'block',
            label: 'B1',
            position: { x: 0, y: 0 },
            config: {}, // missing blockId → fail
          },
          {
            id: 'b2',
            type: 'block',
            label: 'B2',
            position: { x: 0, y: 1 },
            config: {},
          },
          { id: 'or', type: 'or_gate', label: 'OR', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'b1', target: 'or' },
          { id: 'e2', source: 'b2', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (e) => events.push(e),
    });

    const orFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'or',
    ) as { error: string } | undefined;
    expect(orFailed?.error).toMatch(/OR gate: all branches failed/);
  });

  it('truncates huge outputs and scrubs errors on concurrent branch runNode path', async () => {
    registerNativeBlock({
      blockId: 'race_huge',
      execute: async () => ({
        ok: true,
        output: { blob: 'H'.repeat(1_100_000) },
        durationMs: 0,
      }),
    });
    registerBlockMeta({
      id: 'race_huge',
      name: 'Race Huge',
      domain: 'general',
      category: 'test',
      description: 'd',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });
    registerNativeBlock({
      blockId: 'race_err',
      execute: async () => ({
        ok: false,
        output: null,
        error: `bad${'\n'}err${'\0'}!`,
        durationMs: 0,
      }),
    });
    registerBlockMeta({
      id: 'race_err',
      name: 'Race Err',
      domain: 'general',
      category: 'test',
      description: 'd',
      isBuiltIn: true,
      implementationType: 'native',
      paramDefs: [],
      inputDescription: '',
      outputDescription: '',
    });

    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-or-race-io',
      workflow: baseWorkflow({
        nodes: [
          {
            id: 'huge',
            type: 'block',
            label: 'Huge',
            position: { x: 0, y: 0 },
            config: { blockId: 'race_huge' },
          },
          {
            id: 'err',
            type: 'block',
            label: 'Err',
            position: { x: 0, y: 1 },
            config: { blockId: 'race_err' },
          },
          { id: 'or', type: 'or_gate', label: 'OR', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'huge', target: 'or' },
          { id: 'e2', source: 'err', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (e) => events.push(e),
    });

    const hugeDone = events.find(
      (e) => e.type === 'node.completed' && (e as { nodeId: string }).nodeId === 'huge',
    ) as { output?: { truncated?: boolean } } | undefined;
    expect(hugeDone?.output).toMatchObject({ truncated: true });

    const errFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'err',
    ) as { error?: string } | undefined;
    expect(errFailed?.error).toBeDefined();
    expect(errFailed!.error).not.toMatch(/[\r\n\0]/);

    // Winner path completes or_gate
    expect(
      events.some((e) => e.type === 'node.completed' && (e as { nodeId: string }).nodeId === 'or'),
    ).toBe(true);
  });
});
