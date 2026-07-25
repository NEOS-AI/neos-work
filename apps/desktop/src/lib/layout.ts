/**
 * Auto-layout utility using dagre.
 * Applies a top-down (TB) or left-right (LR) layout to React Flow nodes.
 */

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;
/** Align with workflow-engine graph caps (plan Task 15). */
const LAYOUT_NODES_MAX = 2_000;
const LAYOUT_EDGES_MAX = 10_000;
const LAYOUT_ID_MAX = 200;

function isSafeLayoutId(id: string): boolean {
  return id.length > 0 && id.length <= LAYOUT_ID_MAX && !/[\0\r\n]/.test(id);
}

export function autoLayout<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): Node<T>[] {
  if (!nodes.length) return [];
  // Cap graph size for layout (skip excess rather than freeze UI)
  const nodeList = nodes.slice(0, LAYOUT_NODES_MAX);
  const edgeList = edges.slice(0, LAYOUT_EDGES_MAX);

  const dir = direction === 'LR' ? 'LR' : 'TB';
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: dir, ranksep: 80, nodesep: 50 });

  // Map trimmed id → original React Flow id (layout positions stay on original ids).
  // Control-char ids skipped before trim so "\nn1" cannot layout as "n1".
  const nodeIds = new Set<string>();
  const byTrimmed = new Map<string, string>();
  for (const node of nodeList) {
    const raw = typeof node?.id === 'string' ? node.id : '';
    if (!raw || /[\0\r\n]/.test(raw)) continue;
    const id = raw.trim();
    if (!isSafeLayoutId(id)) continue;
    // Prefer original id for layout map (React Flow ids are not re-trimmed in output)
    nodeIds.add(node.id);
    nodeIds.add(id);
    if (!byTrimmed.has(id)) byTrimmed.set(id, node.id);
    g.setNode(node.id, {
      width: node.measured?.width ?? DEFAULT_NODE_WIDTH,
      height: node.measured?.height ?? DEFAULT_NODE_HEIGHT,
    });
  }

  for (const edge of edgeList) {
    const sourceRaw = typeof edge?.source === 'string' ? edge.source : '';
    const targetRaw = typeof edge?.target === 'string' ? edge.target : '';
    if (!sourceRaw || !targetRaw || /[\0\r\n]/.test(sourceRaw) || /[\0\r\n]/.test(targetRaw)) {
      continue;
    }
    const source = sourceRaw.trim();
    const target = targetRaw.trim();
    if (!isSafeLayoutId(source) || !isSafeLayoutId(target)) continue;
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

  // Preserve full input list; only update positions for nodes included in the layout graph
  return nodes.map((node) => {
    const pos = g.hasNode(node.id) ? g.node(node.id) : undefined;
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
