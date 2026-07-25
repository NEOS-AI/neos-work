/**
 * DAG topological sort using Kahn's algorithm (BFS).
 * Throws if a cycle is detected.
 */

import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';

/** Cap nodes/edges accepted for sort (runaway graph defense). */
export const GRAPH_NODES_MAX = 2_000;
export const GRAPH_EDGES_MAX = 10_000;
/** Cap single node/edge id length. */
export const GRAPH_ID_MAX_CHARS = 200;

export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];
  if (nodeList.length > GRAPH_NODES_MAX) {
    throw new Error(`Workflow exceeds max nodes (${GRAPH_NODES_MAX})`);
  }
  if (edgeList.length > GRAPH_EDGES_MAX) {
    throw new Error(`Workflow exceeds max edges (${GRAPH_EDGES_MAX})`);
  }

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodeList) {
    const rawId = typeof node?.id === 'string' ? node.id : '';
    // Control-char check before trim
    if (!rawId || /[\0\r\n]/.test(rawId)) continue;
    const id = rawId.trim();
    if (!id || id.length > GRAPH_ID_MAX_CHARS || nodeMap.has(id)) {
      continue;
    }
    inDegree.set(id, 0);
    adj.set(id, []);
    nodeMap.set(id, node.id === id ? node : { ...node, id });
  }

  for (const edge of edgeList) {
    const sourceRaw = typeof edge?.source === 'string' ? edge.source : '';
    const targetRaw = typeof edge?.target === 'string' ? edge.target : '';
    // Skip dangling / overlong / control-char endpoints (before trim)
    if (
      !sourceRaw
      || !targetRaw
      || /[\0\r\n]/.test(sourceRaw)
      || /[\0\r\n]/.test(targetRaw)
    ) {
      continue;
    }
    const source = sourceRaw.trim();
    const target = targetRaw.trim();
    if (
      !source
      || !target
      || source.length > GRAPH_ID_MAX_CHARS
      || target.length > GRAPH_ID_MAX_CHARS
      || !nodeMap.has(source)
      || !nodeMap.has(target)
    ) {
      continue;
    }
    // Self-loops increase in-degree and surface as cycle detection below
    adj.get(source)!.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  // Nodes in nodeMap already have sanitized ids (control-char entries dropped above)
  const queue: WorkflowNode[] = [...nodeMap.values()].filter((n) => {
    const id = typeof n.id === 'string' ? n.id : '';
    return id && (inDegree.get(id) ?? 0) === 0;
  });
  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    const nid = typeof node.id === 'string' ? node.id : '';
    if (!nid) continue;
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
