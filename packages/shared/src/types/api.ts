/**
 * API request/response types for client-server communication.
 */

import type { ChatMessage, Session, Workspace } from './session.js';
import type {
  NodeType,
  WorkflowNode,
  WorkflowEdge,
  Workflow,
  WorkflowRun,
  AgentHarness,
  DomainWorker,
  DomainPack,
  WorkflowBlock,
} from './workflow.js';

// --- REST API Types ---

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// Workspace
export interface CreateWorkspaceRequest {
  name: string;
  path?: string;
  type: 'local' | 'remote';
}

// Session
export interface CreateSessionRequest {
  workspaceId: string;
  title?: string;
  provider?: string;
  model?: string;
}

// Message
export interface SendMessageRequest {
  content: string;
}

// Settings
export interface Settings {
  apiKeys: Record<string, string>;
  language: string;
  theme: 'dark' | 'light' | 'system';
  defaultProvider: string;
  defaultModel: string;
}

// --- SSE Event Types ---

export type SSEEventType =
  | 'message.chunk'
  | 'message.complete'
  | 'agent.step'
  | 'agent.thinking'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'agent.error'
  | 'session.status';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  sessionId: string;
  timestamp: string;
}

// Health
export interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
  uptime: number;
}

// Re-export for convenience
export type { ChatMessage, Session, Workspace };

// ── 워크플로우 API 타입 ────────────────────────────────────

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  /**
   * Primary pack id. Accepts legacy `domain` values (finance|coding|general)
   * and future pack ids. Prefer aligning with Workflow.primaryDomain.
   */
  domain: string;
  /** Optional v2 field; when set, preferred over domain for primary pack. */
  primaryDomain?: string;
  domainPackIds?: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  primaryDomain?: string;
  domainPackIds?: string[];
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
}

export type WorkflowSSEEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; nodeId: string; nodeType: NodeType }
  | { type: 'node.progress'; nodeId: string; chunk: string; accumulated: string }
  | { type: 'node.completed'; nodeId: string; output: unknown; durationMs: number }
  | { type: 'node.failed'; nodeId: string; error: string }
  /** Soft typed-ports / preflight warning (Task 9); does not fail the run by default. */
  | { type: 'node.warning'; nodeId: string; message: string }
  | { type: 'run.completed'; runId: string; duration: number; artifactId?: string }
  | { type: 'run.failed'; runId: string; error: string }
  // BC-5: worker event stream (coordinator children + solo worker telemetry)
  | {
      type: 'worker.started';
      nodeId: string;
      workerId: string;
      workerRunId: string;
    }
  | {
      type: 'worker.progress';
      nodeId: string;
      workerRunId: string;
      chunk: string;
    }
  | {
      type: 'worker.completed';
      nodeId: string;
      workerRunId: string;
      output: unknown;
    }
  | {
      type: 'worker.failed';
      nodeId: string;
      workerRunId: string;
      error: string;
    };

// ── Worker / Harness API 타입 ──────────────────────────────

/** @deprecated Prefer CreateWorkerRequest */
export interface CreateHarnessRequest {
  id: string;
  name: string;
  domain: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  constraints?: DomainWorker['constraints'];
}

export type CreateWorkerRequest = CreateHarnessRequest & {
  permissionProfile?: DomainWorker['permissionProfile'];
  workspace?: DomainWorker['workspace'];
  defaultMode?: DomainWorker['defaultMode'];
  preferredBlockIds?: string[];
};

// Re-export workflow types for convenience
export type {
  NodeType,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  AgentHarness,
  DomainWorker,
  DomainPack,
  WorkflowBlock,
};
