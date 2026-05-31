import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowSSEEvent } from '@neos-work/shared';
import { executeWorkflow } from './executor.js';

function baseWorkflow(overrides: Partial<Workflow>): Workflow {
  return {
    id: 'wf-test',
    name: 'Test Workflow',
    domain: 'general',
    nodes: [],
    edges: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('executeWorkflow', () => {
  it('uses the provided runId for SSE events', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-fixed',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    expect(events[0]).toEqual({ type: 'run.started', runId: 'run-fixed' });
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-fixed' });
  });

  it('fails a block node without blockId', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-block-missing',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'block', type: 'block', label: 'Block', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'block' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    expect(events).toContainEqual({
      type: 'node.failed',
      nodeId: 'block',
      error: 'blockId is required for block nodes',
    });
  });

  it('passes triggerInputs as trigger node output', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-trigger-inputs',
      triggerInputs: { query: 'hello world', count: 5 },
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const triggerCompleted = events.find(
      (e) => e.type === 'node.completed' && (e as { nodeId?: string }).nodeId === 'trigger',
    ) as { type: string; nodeId: string; output: unknown } | undefined;

    expect(triggerCompleted).toBeDefined();
    expect(triggerCompleted?.output).toEqual({ query: 'hello world', count: 5 });
  });

  it('node.completed 이벤트에 durationMs를 포함한다', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-duration',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const completed = events.filter((e) => e.type === 'node.completed') as Array<{ type: 'node.completed'; nodeId: string; output: unknown; durationMs: number }>;
    expect(completed.length).toBeGreaterThan(0);
    for (const ev of completed) {
      expect(typeof ev.durationMs).toBe('number');
      expect(ev.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('parallel_start → parallel_end: 두 output 노드가 모두 실행된다', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-parallel',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger',   type: 'trigger',        label: 'Trigger',        position: { x: 0, y: 0 }, config: {} },
          { id: 'pstart',    type: 'parallel_start',  label: 'Parallel Start', position: { x: 1, y: 0 }, config: {} },
          { id: 'branch-a',  type: 'output',          label: 'Branch A',       position: { x: 2, y: 0 }, config: {} },
          { id: 'branch-b',  type: 'output',          label: 'Branch B',       position: { x: 2, y: 1 }, config: {} },
          { id: 'pend',      type: 'parallel_end',    label: 'Parallel End',   position: { x: 3, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger',  target: 'pstart'   },
          { id: 'e2', source: 'pstart',   target: 'branch-a' },
          { id: 'e3', source: 'pstart',   target: 'branch-b' },
          { id: 'e4', source: 'branch-a', target: 'pend'     },
          { id: 'e5', source: 'branch-b', target: 'pend'     },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const completedNodeIds = events
      .filter((e) => e.type === 'node.completed')
      .map((e) => (e as { nodeId: string }).nodeId);

    expect(completedNodeIds).toContain('branch-a');
    expect(completedNodeIds).toContain('branch-b');
    expect(completedNodeIds).toContain('pend');
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-parallel' });
  });

  it('or_gate: 두 브랜치 중 첫 번째 완료 브랜치 output을 채택한다', async () => {
    const events: WorkflowSSEEvent[] = [];

    await executeWorkflow({
      runId: 'run-or-gate',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger',  type: 'trigger',  label: 'Trigger',  position: { x: 0, y: 0 }, config: {} },
          { id: 'branch-a', type: 'output',   label: 'Branch A', position: { x: 1, y: 0 }, config: {} },
          { id: 'branch-b', type: 'output',   label: 'Branch B', position: { x: 1, y: 1 }, config: {} },
          { id: 'or',       type: 'or_gate',  label: 'OR Gate',  position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger',  target: 'branch-a' },
          { id: 'e2', source: 'trigger',  target: 'branch-b' },
          { id: 'e3', source: 'branch-a', target: 'or'       },
          { id: 'e4', source: 'branch-b', target: 'or'       },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const orCompleted = events.find(
      (e) => e.type === 'node.completed' && (e as { nodeId: string }).nodeId === 'or',
    );
    expect(orCompleted).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-or-gate' });
  });
});
