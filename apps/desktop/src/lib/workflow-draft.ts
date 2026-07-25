/**
 * Pure helpers for WorkflowEditor draft serialization and React Flow mapping.
 */

import type { Edge, Node } from '@xyflow/react';

export interface WorkflowDraftNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowDraftEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowDraft {
  description?: string;
  designSystemId?: string;
  nodes: WorkflowDraftNode[];
  edges: WorkflowDraftEdge[];
}

/** Serializable workflow graph from React Flow state (shared by save/run/validation). */
export function buildWorkflowDraft(
  nodes: Node[],
  edges: Edge[],
  description?: string,
  designSystemId?: string,
): WorkflowDraft {
  // Control-char designSystemId never persisted (check before empty)
  let safeDesignId: string | undefined;
  if (typeof designSystemId === 'string' && designSystemId) {
    if (!/[\0\r\n]/.test(designSystemId)) {
      const id = designSystemId.trim();
      if (id && id.length <= 64) safeDesignId = id;
    }
  }
  // Multi-line description OK; null-byte dropped
  let safeDescription: string | undefined;
  if (typeof description === 'string' && description && !/\0/.test(description)) {
    const d = description.trim();
    if (d) safeDescription = d;
  }
  return {
    description: safeDescription,
    designSystemId: safeDesignId,
    nodes: nodes.map((n) => {
      // Control-char node labels fall back to id (align with canvas scrub + validation)
      let label = '';
      const rawLabel = n.data.label;
      if (typeof rawLabel === 'string' && rawLabel && !/[\0\r\n]/.test(rawLabel)) {
        label = rawLabel.trim().slice(0, 200);
      }
      if (!label) {
        const id = String(n.id ?? '');
        label = id && !/[\0\r\n]/.test(id) ? id.trim().slice(0, 80) : 'node';
      }
      // Control-char nodeType dropped → generic 'block' fallback is wrong; keep raw only if clean
      let nodeType = 'trigger';
      const rawType = n.data.nodeType;
      if (typeof rawType === 'string' && rawType && !/[\0\r\n]/.test(rawType)) {
        const t = rawType.trim().slice(0, 64);
        if (t) nodeType = t;
      }
      return {
        id: n.id,
        type: nodeType,
        label,
        position: n.position,
        config: (n.data.config as Record<string, unknown>) ?? {},
      };
    }),
    edges: edges.map((e) => {
      // Control-char edge labels dropped (not stripped to a valid label)
      let label: string | undefined;
      if (typeof e.label === 'string' && e.label && !/[\0\r\n]/.test(e.label)) {
        const l = e.label.trim();
        if (l) label = l.slice(0, 200);
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label,
      };
    }),
  };
}

export interface WorkflowGraphLike {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
  }>;
}

/** Map persisted workflow nodes to React Flow nodes with optional run status styling. */
export function toReactFlowNodes(
  wf: WorkflowGraphLike,
  runStatuses: Record<string, string>,
): Node[] {
  return wf.nodes.map((n) => {
    let label = '';
    if (typeof n.label === 'string' && n.label && !/[\0\r\n]/.test(n.label)) {
      label = n.label.trim().slice(0, 200);
    }
    if (!label) {
      const id = String(n.id ?? '');
      label = id && !/[\0\r\n]/.test(id) ? id.trim().slice(0, 80) : 'node';
    }
    let nodeType = 'trigger';
    if (typeof n.type === 'string' && n.type && !/[\0\r\n]/.test(n.type)) {
      const t = n.type.trim().slice(0, 64);
      if (t) nodeType = t;
    }
    return {
      id: n.id,
      type: 'workflowNode',
      position: n.position,
      data: {
        label,
        nodeType,
        config: n.config,
        isRunning: runStatuses[n.id] === 'running',
        isDone: runStatuses[n.id] === 'completed',
        isFailed: runStatuses[n.id] === 'failed',
      },
    };
  });
}

/** Map persisted workflow edges to React Flow edges. */
export function toReactFlowEdges(wf: Pick<WorkflowGraphLike, 'edges'>): Edge[] {
  return wf.edges.map((e) => {
    let label: string | undefined;
    if (typeof e.label === 'string' && e.label && !/[\0\r\n]/.test(e.label)) {
      const l = e.label.trim();
      if (l) label = l.slice(0, 200);
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label,
    };
  });
}
