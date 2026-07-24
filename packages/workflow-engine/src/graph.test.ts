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

  it('ignores dangling edges and still sorts reachable graph', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'trigger', target: 'block' },
      { id: 'e2', source: 'block', target: 'output' },
      { id: 'ghost', source: 'trigger', target: 'missing' },
      { id: 'blank', source: '', target: 'block' },
    ];
    expect(topologicalSort(nodes, edges).map((n) => n.id)).toEqual([
      'trigger',
      'block',
      'output',
    ]);
  });

  it('throws on self-loop cycle', () => {
    const edges: WorkflowEdge[] = [{ id: 'e1', source: 'block', target: 'block' }];
    expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
  });

  it('handles diamond DAG (fan-out / fan-in)', () => {
    const diamondNodes: WorkflowNode[] = [
      { id: 'a', type: 'trigger', label: 'A', position: { x: 0, y: 0 }, config: {} },
      { id: 'b', type: 'output', label: 'B', position: { x: 1, y: 0 }, config: {} },
      { id: 'c', type: 'output', label: 'C', position: { x: 1, y: 1 }, config: {} },
      { id: 'd', type: 'output', label: 'D', position: { x: 2, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'd' },
      { id: 'e4', source: 'c', target: 'd' },
    ];
    const order = topologicalSort(diamondNodes, edges).map((n) => n.id);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    expect(order).toHaveLength(4);
  });

  it('returns empty array for empty graph', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('keeps isolated nodes (no edges)', () => {
    const isolated: WorkflowNode[] = [
      { id: 'x', type: 'trigger', label: 'X', position: { x: 0, y: 0 }, config: {} },
      { id: 'y', type: 'output', label: 'Y', position: { x: 1, y: 0 }, config: {} },
    ];
    const order = topologicalSort(isolated, []).map((n) => n.id);
    expect(order.sort()).toEqual(['x', 'y']);
  });

  it('ignores dangling edges to missing targets (does not throw)', () => {
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'trigger', target: 'ghost' },
      { id: 'e2', source: 'trigger', target: 'block' },
      { id: 'e3', source: 'block', target: 'output' },
    ];
    // ghost is not a node — Kahn still orders the real DAG
    const order = topologicalSort(nodes, edges).map((n) => n.id);
    expect(order).toEqual(['trigger', 'block', 'output']);
  });

  it('orders a single self-contained node with no outgoing edges', () => {
    const single: WorkflowNode[] = [
      { id: 'only', type: 'trigger', label: 'Only', position: { x: 0, y: 0 }, config: {} },
    ];
    expect(topologicalSort(single, []).map((n) => n.id)).toEqual(['only']);
  });

  it('skips blank and duplicate node ids; trims padded ids', () => {
    const nodes: WorkflowNode[] = [
      { id: '  a  ', type: 'trigger', label: 'A', position: { x: 0, y: 0 }, config: {} },
      { id: '   ', type: 'output', label: 'blank', position: { x: 1, y: 0 }, config: {} },
      { id: 'a', type: 'output', label: 'dup', position: { x: 2, y: 0 }, config: {} },
      { id: 'b', type: 'output', label: 'B', position: { x: 3, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: '  a  ', target: '  b  ' },
      { id: 'e-blank', source: '  ', target: 'b' },
    ];
    const order = topologicalSort(nodes, edges).map((n) => n.id);
    expect(order).toEqual(['a', 'b']);
  });
});
