/**
 * Re-export shared workflow-draft helpers with xyflow node/edge types (v0.25 Track D).
 */
import type { Edge, Node } from '@xyflow/react';
import {
  buildWorkflowDraft as buildShared,
  toReactFlowEdges as toEdgesShared,
  toReactFlowNodes as toNodesShared,
  type WorkflowDraft,
  type WorkflowDraftEdge,
  type WorkflowDraftNode,
  type WorkflowGraphLike,
} from '@neos-work/shared';

export type { WorkflowDraft, WorkflowDraftEdge, WorkflowDraftNode, WorkflowGraphLike };

export function buildWorkflowDraft(
  nodes: Node[],
  edges: Edge[],
  description?: string,
  designSystemId?: string,
): WorkflowDraft {
  return buildShared(nodes, edges, description, designSystemId);
}

export function toReactFlowNodes(
  wf: WorkflowGraphLike,
  runStatuses: Record<string, string>,
): Node[] {
  return toNodesShared(wf, runStatuses) as Node[];
}

export function toReactFlowEdges(wf: Pick<WorkflowGraphLike, 'edges'>): Edge[] {
  return toEdgesShared(wf) as Edge[];
}
