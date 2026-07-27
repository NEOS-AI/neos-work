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
  /** Called per streaming text chunk from agent nodes. */
  onProgress?: (chunk: string, accumulated: string) => void;
  /**
   * Optional CLI spawn function injected by the server.
   * Agent registry ids (`cli-*`, e.g. claude, aider, opencode, …) — v0.5.6 N CLIs.
   * Host maps id → agent-runtime launch without coupling this package to child_process.
   */
  cliSpawn?: (
    cliId: string,
    prompt: string,
    onChunk?: (chunk: string, accumulated: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ output: string; exitCode: number | null }>;
  /**
   * Optional Design System content (DESIGN.md) injected by the server.
   * When present, AgentNode prepends this as a design context block
   * before the system prompt.
   */
  designSystemContent?: string;
  /**
   * Optional worker lifecycle bridge (Task 5). Executor maps these to SSE
   * `worker.started|progress|completed|failed` for Run Log nesting.
   */
  onWorkerEvent?: (event: {
    type: 'worker.started' | 'worker.progress' | 'worker.completed' | 'worker.failed';
    workerId: string;
    workerRunId: string;
    chunk?: string;
    output?: unknown;
    error?: string;
  }) => void;
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
