import { describe, expect, it } from 'vitest';
import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';
import { topologicalSort } from './graph.js';

const nodes: WorkflowNode[] = [
  { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
  { id: 'block', type: 'block', label: 'Block', position: { x: 1, y: 0 }, config: { blockId: 'price_lookup' } },
  { id: 'output', type: 'output', label: 'Output', position: { x: 2, y: 0 }, config: {} },
];

describe('topologicalSort', () => {
  it('orders nodes before their downstream targets', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'trigger', target: 'block' },
      { id: 'e2', source: 'block', target: 'output' },
    ];

    expect(topologicalSort(nodes, edges).map((node) => node.id)).toEqual(['trigger', 'block', 'output']);
  });

  it('throws when the workflow contains a cycle', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'trigger', target: 'block' },
      { id: 'e2', source: 'block', target: 'trigger' },
    ];

    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });
});
