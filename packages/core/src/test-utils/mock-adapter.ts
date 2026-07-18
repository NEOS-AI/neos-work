import type { ChatChunk, Model, ProviderId } from '@neos-work/shared';
import type { LLMProviderAdapter } from '../llm/provider.js';

const DEFAULT_MODEL: Model = {
  id: 'mock-model',
  name: 'Mock Model',
  providerId: 'openai',
  contextWindow: 128_000,
  supportsThinking: false,
  supportsTools: true,
  supportsVision: false,
};

/** Sequential text responses for each chat() call. */
export function mockAdapter(
  responses: string[] = [''],
  opts?: { id?: ProviderId; models?: Model[] },
): LLMProviderAdapter {
  let call = 0;
  return {
    id: opts?.id ?? 'openai',
    name: 'Mock',
    getModels: () => opts?.models ?? [DEFAULT_MODEL],
    async *chat(): AsyncIterable<ChatChunk> {
      const text = responses[Math.min(call, responses.length - 1)] ?? '';
      call += 1;
      if (text) yield { type: 'text', content: text };
      yield { type: 'done' };
    },
    async validateApiKey() {
      return true;
    },
  };
}
