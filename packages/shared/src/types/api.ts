/**
 * API request/response types for client-server communication.
 */

import type { ChatMessage, Session, Workspace } from './session.js';
import type { NodeType, WorkflowNode, WorkflowEdge, Workflow, WorkflowRun, AgentHarness, WorkflowBlock } from './workflow.js';

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
  domain: 'finance' | 'coding' | 'general';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
}

export type WorkflowSSEEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; nodeId: string; nodeType: NodeType }
  | { type: 'node.completed'; nodeId: string; output: unknown }
  | { type: 'node.failed'; nodeId: string; error: string }
  | { type: 'run.completed'; runId: string; duration: number }
  | { type: 'run.failed'; runId: string; error: string };

// ── 하네스 API 타입 ────────────────────────────────────────

export interface CreateHarnessRequest {
  id: string;
  name: string;
  domain: 'finance' | 'coding' | 'general';
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  constraints?: AgentHarness['constraints'];
}

// Re-export workflow types for convenience
export type { NodeType, Workflow, WorkflowNode, WorkflowEdge, WorkflowRun, AgentHarness, WorkflowBlock };
