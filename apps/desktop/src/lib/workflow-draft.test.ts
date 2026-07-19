import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  buildWorkflowDraft,
  toReactFlowEdges,
  toReactFlowNodes,
} from './workflow-draft.js';

function rfNode(
  id: string,
  opts: { label?: string; nodeType?: string; config?: Record<string, unknown>; x?: number; y?: number } = {},
): Node {
  return {
    id,
    position: { x: opts.x ?? 0, y: opts.y ?? 0 },
    type: 'workflowNode',
    data: {
      label: opts.label ?? id,
      nodeType: opts.nodeType ?? 'trigger',
      config: opts.config,
    },
  };
}

describe('buildWorkflowDraft', () => {
  it('maps React Flow nodes/edges to workflow draft fields', () => {
    const nodes = [
      rfNode('a', { label: 'Start', nodeType: 'trigger', x: 10, y: 20, config: { foo: 1 } }),
      rfNode('b', { label: 'End', nodeType: 'output', x: 30, y: 40 }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b', label: 'next' }];
    const draft = buildWorkflowDraft(nodes, edges, 'desc', 'ds-1');
    expect(draft.description).toBe('desc');
    expect(draft.designSystemId).toBe('ds-1');
    expect(draft.nodes).toEqual([
      {
        id: 'a',
        type: 'trigger',
        label: 'Start',
        position: { x: 10, y: 20 },
        config: { foo: 1 },
      },
      {
        id: 'b',
        type: 'output',
        label: 'End',
        position: { x: 30, y: 40 },
        config: {},
      },
    ]);
    expect(draft.edges).toEqual([{ id: 'e1', source: 'a', target: 'b', label: 'next' }]);
  });

  it('treats empty designSystemId as undefined', () => {
    const draft = buildWorkflowDraft([], [], undefined, '');
    expect(draft.designSystemId).toBeUndefined();
  });

  it('defaults missing node config to empty object', () => {
    const nodes = [rfNode('n1')];
    // explicit undefined config
    nodes[0]!.data.config = undefined;
    const draft = buildWorkflowDraft(nodes, []);
    expect(draft.nodes[0]!.config).toEqual({});
  });
});

describe('toReactFlowNodes / toReactFlowEdges', () => {
  const wf = {
    nodes: [
      {
        id: 'n1',
        type: 'agent_coding',
        label: 'Coder',
        position: { x: 1, y: 2 },
        config: { model: 'x' },
      },
      {
        id: 'n2',
        type: 'output',
        label: 'Out',
        position: { x: 3, y: 4 },
        config: {},
      },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'go' }],
  };

  it('maps workflow graph into React Flow nodes with run status flags', () => {
    const nodes = toReactFlowNodes(wf, { n1: 'running', n2: 'completed' });
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'n1',
      type: 'workflowNode',
      position: { x: 1, y: 2 },
      data: {
        label: 'Coder',
        nodeType: 'agent_coding',
        config: { model: 'x' },
        isRunning: true,
        isDone: false,
        isFailed: false,
      },
    });
    expect(nodes[1]!.data).toMatchObject({
      isRunning: false,
      isDone: true,
      isFailed: false,
    });
  });

  it('marks failed run status', () => {
    const nodes = toReactFlowNodes(wf, { n1: 'failed' });
    expect(nodes[0]!.data.isFailed).toBe(true);
    expect(nodes[0]!.data.isRunning).toBe(false);
    expect(nodes[0]!.data.isDone).toBe(false);
  });

  it('maps edges including optional labels', () => {
    expect(toReactFlowEdges(wf)).toEqual([
      { id: 'e1', source: 'n1', target: 'n2', label: 'go' },
    ]);
    expect(toReactFlowEdges({ edges: [{ id: 'e2', source: 'a', target: 'b' }] })).toEqual([
      { id: 'e2', source: 'a', target: 'b', label: undefined },
    ]);
  });

  it('round-trips draft build after React Flow conversion', () => {
    const rfNodes = toReactFlowNodes(wf, {});
    const rfEdges = toReactFlowEdges(wf);
    const draft = buildWorkflowDraft(rfNodes, rfEdges, 'hello', 'ds');
    expect(draft.nodes.map((n) => n.type)).toEqual(['agent_coding', 'output']);
    expect(draft.edges).toEqual(wf.edges);
    expect(draft.description).toBe('hello');
  });
});
