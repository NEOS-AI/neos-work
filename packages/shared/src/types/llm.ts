/**
 * LLM Provider abstraction types.
 * Supports Anthropic (Claude) and Google (Gemini).
 */

export type ProviderId = 'anthropic' | 'google';

export interface LLMProvider {
  id: ProviderId;
  name: string;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  providerId: ProviderId;
  contextWindow: number;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  thinkingMode?: ThinkingMode;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatChunk {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
}

export type ThinkingMode = 'none' | 'low' | 'medium' | 'high';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };

export interface ImageSource {
  type: 'base64' | 'url';
  mediaType?: string;
  data: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
