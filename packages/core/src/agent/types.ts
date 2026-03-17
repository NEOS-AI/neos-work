/**
 * Agent type definitions.
 * Shared types for the agent orchestrator and planner.
 */

export type AgentStepType = 'plan' | 'tool_use' | 'tool_result' | 'reasoning' | 'error';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error';
export type AgentTaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentStep {
  id: string;
  index: number;
  description: string;
  type: AgentStepType;
  status: AgentStepStatus;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

export interface AgentTask {
  id: string;
  goal: string;
  steps: AgentStep[];
  status: AgentTaskStatus;
  createdAt: Date;
  completedAt?: Date;
}

/** Events emitted by the orchestrator during execution. */
export type AgentEvent =
  | { type: 'plan'; steps: AgentStep[] }
  | { type: 'step_start'; step: AgentStep }
  | { type: 'step_complete'; step: AgentStep }
  | { type: 'step_error'; step: AgentStep; error: string }
  | { type: 'text'; content: string }
  | { type: 'done'; task: AgentTask }
  | { type: 'error'; error: string };

export interface OrchestratorOptions {
  /** Maximum number of planning + execution iterations. Default: 10 */
  maxIterations?: number;
  /** Model to use for planning and reasoning. Defaults to provider's default. */
  model?: string;
}
