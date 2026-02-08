/**
 * API request/response types for client-server communication.
 */

import type { ChatMessage, Session, Workspace } from './session.js';

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
