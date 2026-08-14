import { describe, expect, it } from 'vitest';
import {
  buildWorkflowDraft,
  toReactFlowEdges,
  toReactFlowNodes,
  type ReactFlowEdgeLike,
  type ReactFlowNodeLike,
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
): ReactFlowNodeLike {
  return {
    id,
    position: { x: opts.x ?? 0, y: opts.y ?? 0 },
    data: {
      label: opts.label ?? id,
      nodeType: opts.nodeType ?? 'trigger',
      config: opts.config,
    },
  };
}

describe('buildWorkflowDraft (shared)', () => {
  it('maps React Flow nodes/edges to workflow draft fields', () => {
    const nodes = [
      rfNode('a', { label: 'Start', nodeType: 'trigger', x: 10, y: 20, config: { foo: 1 } }),
      rfNode('b', { label: 'End', nodeType: 'output', x: 30, y: 40 }),
    ];
    const edges: ReactFlowEdgeLike[] = [{ id: 'e1', source: 'a', target: 'b', label: 'next' }];
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

  it('drops control-char labels and design ids', () => {
    const draft = buildWorkflowDraft(
      [rfNode('n1', { label: 'bad\nlabel', nodeType: 'agent\nid' })],
      [{ id: 'e1', source: 'n1', target: 'n1', label: 'x\ny' }],
      'ok',
      'bad\nid',
    );
    expect(draft.nodes[0]?.label).toBe('n1');
    expect(draft.nodes[0]?.type).toBe('trigger');
    expect(draft.edges[0]?.label).toBeUndefined();
    expect(draft.designSystemId).toBeUndefined();
  });
});

describe('toReactFlowNodes / toReactFlowEdges', () => {
  it('applies run status flags', () => {
    const nodes = toReactFlowNodes(
      {
        nodes: [
          {
            id: 'a',
            type: 'agent',
            label: 'Agent',
            position: { x: 1, y: 2 },
            config: {},
          },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'a', label: 'loop' }],
      },
      { a: 'running' },
    );
    expect(nodes[0]?.data.isRunning).toBe(true);
    expect(nodes[0]?.data.nodeType).toBe('agent');
    expect(toReactFlowEdges({ edges: [{ id: 'e1', source: 'a', target: 'a', label: 'loop' }] })).toEqual([
      { id: 'e1', source: 'a', target: 'a', label: 'loop' },
    ]);
  });
});
