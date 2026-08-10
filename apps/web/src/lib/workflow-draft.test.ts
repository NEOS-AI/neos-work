import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  buildWorkflowDraft,
  toReactFlowEdges,
  toReactFlowNodes,
} from './workflow-draft.js';

function rfNode(
  id: string,
  opts: {
    label?: string;
    nodeType?: string;
    config?: Record<string, unknown>;
    x?: number;
    y?: number;
  } = {},
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

describe('buildWorkflowDraft (web)', () => {
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

  it('rejects control-char labels/types and falls back', () => {
    const nodes = [
      rfNode('n1', { label: `Start${'\0'}X`, nodeType: 'trigger' }),
      rfNode('n2', { label: '\n', nodeType: `agent${'\n'}bad` }),
    ];
    const draft = buildWorkflowDraft(nodes, []);
    expect(draft.nodes[0]!.label).toBe('n1');
    expect(draft.nodes[1]!.type).toBe('trigger');
  });
});

describe('toReactFlowNodes / toReactFlowEdges (web)', () => {
  const wf = {
    nodes: [
      {
        id: 'n1',
        type: 'agent',
        label: 'Agent',
        position: { x: 1, y: 2 },
        config: { workerId: 'general_generalist' },
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

  it('maps with run status flags', () => {
    const nodes = toReactFlowNodes(wf, { n1: 'running', n2: 'completed' });
    expect(nodes[0]!.data).toMatchObject({
      label: 'Agent',
      nodeType: 'agent',
      isRunning: true,
      isDone: false,
    });
    expect(nodes[1]!.data).toMatchObject({ isDone: true });
  });

  it('round-trips draft after conversion', () => {
    const draft = buildWorkflowDraft(toReactFlowNodes(wf, {}), toReactFlowEdges(wf));
    expect(draft.nodes.map((n) => n.type)).toEqual(['agent', 'output']);
    expect(draft.edges).toEqual(wf.edges);
  });
});
