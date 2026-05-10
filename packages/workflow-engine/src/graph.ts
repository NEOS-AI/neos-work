/**
 * DAG topological sort using Kahn's algorithm (BFS).
 * Throws if a cycle is detected.
 */

import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';

export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: WorkflowNode[] = nodes.filter((n) => inDegree.get(n.id) === 0);
  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighborId of adj.get(node.id) ?? []) {
      const newDeg = (inDegree.get(neighborId) ?? 1) - 1;
      inDegree.set(neighborId, newDeg);
      if (newDeg === 0) {
        const neighborNode = nodeMap.get(neighborId);
        if (neighborNode) queue.push(neighborNode);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Workflow contains a cycle');
  }

  return sorted;
}
