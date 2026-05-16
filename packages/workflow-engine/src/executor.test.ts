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
});
