/**
 * Session and workspace types shared between frontend and backend.
 */

import type { ProviderId, ThinkingMode } from './llm.js';

export interface Workspace {
  id: string;
  name: string;
  path: string | null;
  type: 'local' | 'remote';
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string | null;
  provider: ProviderId;
  model: string;
  thinkingMode: ThinkingMode;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: ChatMessageMetadata | null;
  createdAt: string;
}

export interface ChatMessageMetadata {
  steps?: AgentStep[];
  fileRefs?: string[];
  tokenCount?: number;
}

export interface AgentStep {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: 'running' | 'completed' | 'error';
  createdAt: string;
}
