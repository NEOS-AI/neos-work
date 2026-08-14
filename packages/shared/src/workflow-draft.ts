/**
 * Pure helpers for WorkflowEditor draft serialization and React Flow mapping.
 * xyflow-agnostic shapes so desktop and web share one module (v0.25 Track D).
 */

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

/** Minimal React Flow node shape (avoid depending on @xyflow/react in shared). */
export interface ReactFlowNodeLike {
  id: string;
  position: { x: number; y: number };
  data?: {
    label?: unknown;
    nodeType?: unknown;
    config?: Record<string, unknown>;
  };
}

/** Minimal React Flow edge shape. */
export interface ReactFlowEdgeLike {
  id: string;
  source: string;
  target: string;
  label?: unknown;
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

/** Serializable workflow graph from React Flow state (shared by save/run/validation). */
export function buildWorkflowDraft(
  nodes: ReactFlowNodeLike[],
  edges: ReactFlowEdgeLike[],
  description?: string,
  designSystemId?: string,
): WorkflowDraft {
  let safeDesignId: string | undefined;
  if (typeof designSystemId === 'string' && designSystemId) {
    if (!/[\0\r\n]/.test(designSystemId)) {
      const id = designSystemId.trim();
      if (id && id.length <= 64) safeDesignId = id;
    }
  }
  let safeDescription: string | undefined;
  if (typeof description === 'string' && description && !/\0/.test(description)) {
    const d = description.trim();
    if (d) safeDescription = d;
  }
  return {
    description: safeDescription,
    designSystemId: safeDesignId,
    nodes: nodes.map((n) => {
      let label = '';
      const rawLabel = n.data?.label;
      if (typeof rawLabel === 'string' && rawLabel && !/[\0\r\n]/.test(rawLabel)) {
        label = rawLabel.trim().slice(0, 200);
      }
      if (!label) {
        const id = String(n.id ?? '');
        label = id && !/[\0\r\n]/.test(id) ? id.trim().slice(0, 80) : 'node';
      }
      let nodeType = 'trigger';
      const rawType = n.data?.nodeType;
      if (typeof rawType === 'string' && rawType && !/[\0\r\n]/.test(rawType)) {
        const t = rawType.trim().slice(0, 64);
        if (t) nodeType = t;
      }
      return {
        id: n.id,
        type: nodeType,
        label,
        position: n.position,
        config: n.data?.config ?? {},
      };
    }),
    edges: edges.map((e) => {
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

/** Map persisted workflow nodes to React Flow nodes with optional run status styling. */
export function toReactFlowNodes(
  wf: WorkflowGraphLike,
  runStatuses: Record<string, string>,
): Array<{
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    config: Record<string, unknown>;
    isRunning: boolean;
    isDone: boolean;
    isFailed: boolean;
  };
}> {
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
export function toReactFlowEdges(wf: Pick<WorkflowGraphLike, 'edges'>): Array<{
  id: string;
  source: string;
  target: string;
  label?: string;
}> {
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
