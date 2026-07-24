/**
 * Auto-layout utility using dagre.
 * Applies a top-down (TB) or left-right (LR) layout to React Flow nodes.
 */

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

export function autoLayout<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): Node<T>[] {
  if (!nodes.length) return [];

  const dir = direction === 'LR' ? 'LR' : 'TB';
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: dir, ranksep: 80, nodesep: 50 });

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node?.id) continue;
    nodeIds.add(node.id);
    g.setNode(node.id, {
      width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
      height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    if (!edge?.source || !edge?.target) continue;
    // Skip dangling edges so dagre does not throw on missing nodes
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) {
      return node;
    }
    const w = node.measured?.width ?? DEFAULT_NODE_WIDTH;
    const h = node.measured?.height ?? DEFAULT_NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}
