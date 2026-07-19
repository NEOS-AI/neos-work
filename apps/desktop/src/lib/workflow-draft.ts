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
  return {
    description,
    designSystemId: designSystemId || undefined,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType as string,
      label: n.data.label as string,
      position: n.position,
      config: (n.data.config as Record<string, unknown>) ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label as string | undefined,
    })),
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
  return wf.nodes.map((n) => ({
    id: n.id,
    type: 'workflowNode',
    position: n.position,
    data: {
      label: n.label,
      nodeType: n.type,
      config: n.config,
      isRunning: runStatuses[n.id] === 'running',
      isDone: runStatuses[n.id] === 'completed',
      isFailed: runStatuses[n.id] === 'failed',
    },
  }));
}

/** Map persisted workflow edges to React Flow edges. */
export function toReactFlowEdges(wf: Pick<WorkflowGraphLike, 'edges'>): Edge[] {
  return wf.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
  }));
}
