/**
 * Workflow engine core types.
 * ExecutableNode interface and context/result contracts.
 */

import type { NodeType } from '@neos-work/shared';

export type { NodeType };

export interface NodeContext {
  workflowId: string;
  runId: string;
  nodeId: string;
  inputs: Record<string, unknown>;
  settings: Record<string, string>;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface NodeResult {
  ok: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

/**
 * ⚠️ packages/shared의 WorkflowNode(그래프 데이터 노드)와 이름 충돌을 피하기 위해
 * 실행 가능 노드 인터페이스는 ExecutableNode로 명명한다.
 */
export interface ExecutableNode {
  type: NodeType;
  execute(ctx: NodeContext): Promise<NodeResult>;
}
