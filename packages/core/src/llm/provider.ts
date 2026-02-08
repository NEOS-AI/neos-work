/**
 * LLM Provider adapter interface.
 * Each provider (Anthropic, Google) implements this interface.
 */

import type { ChatChunk, ChatParams, Model, ProviderId } from '@neos-work/shared';

export interface LLMProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;

  getModels(): Model[];
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  validateApiKey(apiKey: string): Promise<boolean>;
}
