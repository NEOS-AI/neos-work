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

  it('skips control-char node ids (graph hygiene); does not execute them', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-bad-id',
      workflow: baseWorkflow({
        nodes: [
          { id: 'bad\nid', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          { id: 'ok', type: 'output', label: 'O', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    // Control-char id is dropped by topologicalSort; only valid nodes run
    expect(events.some((e) => e.type === 'node.started' && (e as { nodeId?: string }).nodeId === 'ok')).toBe(true);
    expect(events.some((e) => (e as { nodeId?: string }).nodeId === 'bad\nid')).toBe(false);
  });

  it('ignores control-char edge endpoints (does not wire inputs)', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-bad-edge',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: 'output', label: 'O', position: { x: 1, y: 0 }, config: {} },
        ],
        // Leading control must not strip to a valid endpoint
        edges: [{ id: 'e1', source: '\ntrigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    // Graph drops the edge; both nodes still run independently
    expect(events.some((e) => e.type === 'node.started' && (e as { nodeId?: string }).nodeId === 'trigger')).toBe(true);
    expect(events.some((e) => e.type === 'node.started' && (e as { nodeId?: string }).nodeId === 'output')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
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

describe('executeWorkflow media/deploy nodes', () => {
  it('fails deploy node without content', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-deploy-empty',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'deploy', type: 'deploy', label: 'Deploy', position: { x: 1, y: 0 }, config: { provider: 'vercel' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'deploy' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    expect(events.some((e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'deploy')).toBe(true);
  });

  it('fails media image node without prompt', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-media-empty',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'media', type: 'media', label: 'Media', position: { x: 1, y: 0 }, config: { mediaType: 'image' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'media' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    expect(events.some((e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'media')).toBe(true);
  });

  it('fails web_search node when TAVILY_API_KEY missing', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-search-nokey',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'search', type: 'web_search', label: 'Search', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'search' }],
      }),
      settings: {},
      triggerInputs: { query: 'neos' },
      onEvent: (event) => events.push(event),
    });
    const failed = events.find((e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'search');
    expect(failed).toBeDefined();
    expect((failed as { error: string }).error).toMatch(/TAVILY_API_KEY/);
  });
});

describe('executeWorkflow graph failure and skip paths', () => {
  it('emits run.failed when the graph has a cycle', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-cycle',
      workflow: baseWorkflow({
        nodes: [
          { id: 'a', type: 'output', label: 'A', position: { x: 0, y: 0 }, config: {} },
          { id: 'b', type: 'output', label: 'B', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'a' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    expect(events[0]).toMatchObject({ type: 'run.started', runId: 'run-cycle' });
    expect(events.some((e) => e.type === 'run.failed')).toBe(true);
    expect(events.some((e) => e.type === 'run.completed')).toBe(false);
  });

  it('ignores blank-endpoint edges when wiring inputs', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-blank-edges',
      triggerInputs: { x: 1 },
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e-bad-src', source: '  ', target: 'output' },
          { id: 'e-ok', source: 'trigger', target: 'output' },
          { id: 'e-bad-tgt', source: 'trigger', target: '  ' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    const out = events.find(
      (e) => e.type === 'node.completed' && (e as { nodeId?: string }).nodeId === 'output',
    ) as { output?: unknown } | undefined;
    // Output node should still complete; blank edges do not poison inputs
    expect(out).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-blank-edges' });
  });

  it('matches padded edge endpoints when detecting upstream failures', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-pad-fail-edges',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'b1',
            type: 'block',
            label: 'B1',
            position: { x: 1, y: 0 },
            config: {}, // missing blockId → fail
          },
          { id: 'and', type: 'gate_and', label: 'AND', position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'b1' },
          // padded source/target still wire and fail correctly
          { id: 'e2', source: '  b1  ', target: '  and  ' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const b1Failed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'b1',
    );
    const andFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'and',
    ) as { error: string } | undefined;
    expect(b1Failed).toBeDefined();
    expect(andFailed).toBeDefined();
    expect(andFailed!.error).toMatch(/AND gate/i);
  });

  it('skips downstream nodes when all upstream failed', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-skip-upstream',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'block',
            type: 'block',
            label: 'Block',
            position: { x: 1, y: 0 },
            config: {}, // missing blockId → fails
          },
          { id: 'output', type: 'output', label: 'Output', position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'block' },
          { id: 'e2', source: 'block', target: 'output' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const failed = events.filter((e) => e.type === 'node.failed') as Array<{
      nodeId: string;
      error: string;
    }>;
    expect(failed.some((e) => e.nodeId === 'block')).toBe(true);
    expect(failed.some((e) => e.nodeId === 'output' && /Skipped: all upstream/.test(e.error))).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-skip-upstream' });
  });

  it('stops early when signal is already aborted', async () => {
    const events: WorkflowSSEEvent[] = [];
    const controller = new AbortController();
    controller.abort();

    await executeWorkflow({
      runId: 'run-aborted',
      signal: controller.signal,
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

    expect(events[0]).toMatchObject({ type: 'run.started', runId: 'run-aborted' });
    // aborted before any node work
    expect(events.some((e) => e.type === 'node.started')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-aborted' });
  });

  it('AND gate fails when any upstream failed', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-and-fail',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'block',
            type: 'block',
            label: 'Block',
            position: { x: 1, y: 0 },
            config: {},
          },
          { id: 'ok', type: 'output', label: 'Ok', position: { x: 1, y: 1 }, config: {} },
          { id: 'and', type: 'gate_and', label: 'AND', position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'block' },
          { id: 'e2', source: 'trigger', target: 'ok' },
          { id: 'e3', source: 'block', target: 'and' },
          { id: 'e4', source: 'ok', target: 'and' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const andFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'and',
    ) as { error: string } | undefined;
    expect(andFailed?.error).toMatch(/AND gate/);
  });

  it('legacy gate_or fails when all upstream failed', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-gate-or-all-fail',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'b1',
            type: 'block',
            label: 'B1',
            position: { x: 1, y: 0 },
            config: {}, // missing blockId
          },
          {
            id: 'b2',
            type: 'block',
            label: 'B2',
            position: { x: 1, y: 1 },
            config: {},
          },
          { id: 'or', type: 'gate_or', label: 'OR', position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'b1' },
          { id: 'e2', source: 'trigger', target: 'b2' },
          { id: 'e3', source: 'b1', target: 'or' },
          { id: 'e4', source: 'b2', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const orFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'or',
    ) as { error: string } | undefined;
    expect(orFailed?.error).toMatch(/OR gate: all upstream/);
  });

  it('or_gate fails when all concurrent branches failed', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-or-gate-branches-fail',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'ps', type: 'parallel_start', label: 'PS', position: { x: 1, y: 0 }, config: {} },
          {
            id: 'b1',
            type: 'block',
            label: 'B1',
            position: { x: 2, y: 0 },
            config: {},
          },
          {
            id: 'b2',
            type: 'block',
            label: 'B2',
            position: { x: 2, y: 1 },
            config: {},
          },
          { id: 'or', type: 'or_gate', label: 'OR', position: { x: 3, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'ps' },
          { id: 'e2', source: 'ps', target: 'b1' },
          { id: 'e3', source: 'ps', target: 'b2' },
          { id: 'e4', source: 'b1', target: 'or' },
          { id: 'e5', source: 'b2', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const orFailed = events.find(
      (e) => e.type === 'node.failed' && (e as { nodeId: string }).nodeId === 'or',
    ) as { error: string } | undefined;
    // Sequential topo path: "all upstream"; concurrent race path: "all branches"
    expect(orFailed?.error).toMatch(/OR gate: all (upstream|branches)/);
  });

  it('resolves case-insensitive / padded node types', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-type-case',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: '  TRIGGER  ' as 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: 'output', type: ' Output ' as 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    expect(events.some((e) => e.type === 'node.completed' && (e as { nodeId?: string }).nodeId === 'trigger')).toBe(true);
    expect(events.some((e) => e.type === 'node.completed' && (e as { nodeId?: string }).nodeId === 'output')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
  });

  it('emits trimmed nodeIds for padded node ids and wires padded edges', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-pad-ids',
      workflow: baseWorkflow({
        nodes: [
          { id: '  trigger  ', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
          { id: '  output  ', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: '  trigger  ', target: '  output  ' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    const completed = events.filter((e) => e.type === 'node.completed') as Array<{ nodeId: string }>;
    expect(completed.map((e) => e.nodeId).sort()).toEqual(['output', 'trigger']);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-pad-ids' });
  });

  it('auto-generates a runId when omitted', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
        ],
        edges: [],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const started = events[0] as { type: string; runId: string };
    expect(started.type).toBe('run.started');
    expect(started.runId.length).toBeGreaterThan(8);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: started.runId });
  });

  it('truncates oversized node outputs before emitting node.completed', async () => {
    const events: WorkflowSSEEvent[] = [];
    // > 1 MiB serialized payload (MAX_OUTPUT_BYTES)
    const huge = 'x'.repeat(1_100_000);
    await executeWorkflow({
      runId: 'run-truncate-output',
      triggerInputs: { blob: huge },
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
        ],
        edges: [],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const completed = events.find(
      (e) => e.type === 'node.completed' && (e as { nodeId?: string }).nodeId === 'trigger',
    ) as { output: { truncated?: boolean; preview?: string } } | undefined;
    expect(completed).toBeDefined();
    expect(completed!.output).toMatchObject({ truncated: true });
    expect(typeof completed!.output.preview).toBe('string');
    expect(completed!.output.preview!.length).toBe(256);
  });

  it('truncates oversized node.failed error strings at 4000 chars', async () => {
    const { registerNativeBlock, registerBlockMeta } = await import('./blocks/registry.js');
    registerNativeBlock({
      blockId: 'long_err_block',
      execute: async () => ({
        ok: false,
        output: null,
        error: 'E'.repeat(5_000),
        durationMs: 0,
      }),
    });
    registerBlockMeta({
      id: 'long_err_block',
      name: 'Long Err',
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
      runId: 'run-truncate-error',
      workflow: baseWorkflow({
        nodes: [
          {
            id: 'block',
            type: 'block',
            label: 'LongErr',
            position: { x: 0, y: 0 },
            config: { blockId: 'long_err_block' },
          },
        ],
        edges: [],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const failed = events.find((e) => e.type === 'node.failed') as
      | { error: string; nodeId: string }
      | undefined;
    expect(failed).toBeDefined();
    expect(failed!.nodeId).toBe('block');
    expect(failed!.error.length).toBe(4_000);
    expect(failed!.error.startsWith('E')).toBe(true);
  });

  it('skips blank node ids and throws on unknown node types', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-blank-id',
      workflow: baseWorkflow({
        nodes: [
          { id: '   ', type: 'trigger', label: 'Blank', position: { x: 0, y: 0 }, config: {} },
          { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    // only the non-blank trigger should run
    const started = events.filter((e) => e.type === 'node.started') as Array<{ nodeId: string }>;
    expect(started.map((e) => e.nodeId)).toEqual(['trigger']);

    await expect(
      executeWorkflow({
        runId: 'run-unknown-type',
        workflow: baseWorkflow({
          nodes: [
            {
              id: 'bad',
              type: 'not_a_real_node' as never,
              label: 'Bad',
              position: { x: 0, y: 0 },
              config: {},
            },
          ],
          edges: [],
        }),
        settings: {},
        onEvent: () => {},
      }),
    ).rejects.toThrow(/Unknown node type/i);
  });

  it('caps node.progress chunk and accumulated payloads', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-progress-cap',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'agent',
            type: 'agent_coding',
            label: 'A',
            position: { x: 1, y: 0 },
            config: { provider: 'cli-claude' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agent' }],
      }),
      settings: {},
      cliSpawn: async (_id, _prompt, onChunk) => {
        onChunk?.('C'.repeat(40_000), 'A'.repeat(300_000));
        return { output: 'done', exitCode: 0 };
      },
      onEvent: (event) => events.push(event),
    });

    const progress = events.find((e) => e.type === 'node.progress') as
      | { chunk: string; accumulated: string }
      | undefined;
    expect(progress).toBeDefined();
    expect(progress!.chunk.length).toBe(32_000);
    expect(progress!.accumulated.length).toBe(256_000);
  });

  it('rejects control-char node types and resolves agent/message node types', async () => {
    await expect(
      executeWorkflow({
        runId: 'run-ctrl-type',
        workflow: baseWorkflow({
          nodes: [
            {
              id: 'bad',
              type: 'trigger\n' as never,
              label: 'Bad',
              position: { x: 0, y: 0 },
              config: {},
            },
          ],
          edges: [],
        }),
        settings: {},
        onEvent: () => {},
      }),
    ).rejects.toThrow(/Unknown node type/i);

    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-agent-types',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'fin',
            type: 'agent_finance',
            label: 'F',
            position: { x: 1, y: 0 },
            config: { provider: 'cli-claude' },
          },
          {
            id: 'slack',
            type: 'slack_message',
            label: 'S',
            position: { x: 2, y: 0 },
            config: {},
          },
          {
            id: 'discord',
            type: 'discord_message',
            label: 'D',
            position: { x: 3, y: 0 },
            config: {},
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'fin' },
          { id: 'e2', source: 'fin', target: 'slack' },
          { id: 'e3', source: 'slack', target: 'discord' },
        ],
      }),
      settings: {},
      cliSpawn: async () => ({ output: 'ok', exitCode: 0 }),
      onEvent: (event) => events.push(event),
    });
    // Nodes run (may fail on missing tokens) but types resolve without throwing
    expect(events.some((e) => e.type === 'node.started' && (e as { nodeId: string }).nodeId === 'fin')).toBe(
      true,
    );
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
  });

  it('legacy gate_or keeps first successful upstream input', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-gate-or-success',
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          {
            id: 'b1',
            type: 'block',
            label: 'B1',
            position: { x: 1, y: 0 },
            config: {}, // missing blockId → fail
          },
          { id: 'b2', type: 'output', label: 'B2', position: { x: 1, y: 1 }, config: {} },
          { id: 'or', type: 'gate_or', label: 'OR', position: { x: 2, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'b1' },
          { id: 'e2', source: 'trigger', target: 'b2' },
          { id: 'e3', source: 'b1', target: 'or' },
          { id: 'e4', source: 'b2', target: 'or' },
        ],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });
    expect(
      events.some((e) => e.type === 'node.completed' && (e as { nodeId: string }).nodeId === 'or'),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
  });
});
