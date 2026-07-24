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
    const id = typeof node?.id === 'string' ? node.id.trim() : '';
    if (!id || nodeMap.has(id)) continue;
    inDegree.set(id, 0);
    adj.set(id, []);
    nodeMap.set(id, node.id === id ? node : { ...node, id });
  }

  for (const edge of edges) {
    const source = typeof edge?.source === 'string' ? edge.source.trim() : '';
    const target = typeof edge?.target === 'string' ? edge.target.trim() : '';
    // Skip dangling edges so missing endpoints do not corrupt degree counts
    if (!source || !target || !nodeMap.has(source) || !nodeMap.has(target)) continue;
    // Self-loops increase in-degree and surface as cycle detection below
    adj.get(source)!.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const queue: WorkflowNode[] = [...nodeMap.values()].filter((n) => {
    const id = typeof n.id === 'string' ? n.id.trim() : n.id;
    return (inDegree.get(id) ?? 0) === 0;
  });
  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    const nid = typeof node.id === 'string' ? node.id.trim() : node.id;
    for (const neighborId of adj.get(nid) ?? []) {
      const newDeg = (inDegree.get(neighborId) ?? 1) - 1;
      inDegree.set(neighborId, newDeg);
      if (newDeg === 0) {
        const neighborNode = nodeMap.get(neighborId);
        if (neighborNode) queue.push(neighborNode);
      }
    }
  }

  if (sorted.length !== nodeMap.size) {
    throw new Error('Workflow contains a cycle');
  }

  return sorted;
}
