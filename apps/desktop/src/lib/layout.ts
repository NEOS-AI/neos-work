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

  // Map trimmed id → original React Flow id (layout positions stay on original ids)
  const nodeIds = new Set<string>();
  const byTrimmed = new Map<string, string>();
  for (const node of nodes) {
    const id = typeof node?.id === 'string' ? node.id.trim() : '';
    if (!id) continue;
    // Prefer original id for layout map (React Flow ids are not re-trimmed in output)
    nodeIds.add(node.id);
    nodeIds.add(id);
    if (!byTrimmed.has(id)) byTrimmed.set(id, node.id);
    g.setNode(node.id, {
      width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
      height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    const source = typeof edge?.source === 'string' ? edge.source.trim() : '';
    const target = typeof edge?.target === 'string' ? edge.target.trim() : '';
    if (!source || !target) continue;
    // Skip dangling edges so dagre does not throw on missing nodes
    // Match raw edge endpoints, then trimmed → original node id
    const srcId = nodeIds.has(edge.source)
      ? edge.source
      : (byTrimmed.get(source) ?? (nodeIds.has(source) ? source : ''));
    const tgtId = nodeIds.has(edge.target)
      ? edge.target
      : (byTrimmed.get(target) ?? (nodeIds.has(target) ? target : ''));
    if (!srcId || !tgtId || !g.hasNode(srcId) || !g.hasNode(tgtId)) continue;
    g.setEdge(srcId, tgtId);
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
