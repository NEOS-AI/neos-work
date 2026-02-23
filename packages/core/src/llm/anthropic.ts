/**
 * Anthropic (Claude) LLM provider adapter.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatChunk, ChatParams, Model } from '@neos-work/shared';
import { ANTHROPIC_MODELS, THINKING_BUDGET } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

export class AnthropicAdapter implements LLMProviderAdapter {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  getModels(): Model[] {
    return ANTHROPIC_MODELS;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk, void, unknown> {
    const { model, messages, tools, thinkingMode = 'none', maxTokens = 4096, signal } = params;

    // Separate system messages from conversation
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    const budget = THINKING_BUDGET[thinkingMode];
    const useThinking = budget > 0;

    // Build request params
    const requestParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: useThinking ? budget + maxTokens : maxTokens,
      system: systemPrompt || undefined,
      messages: conversationMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content as Anthropic.ContentBlockParam[],
      })),
      stream: true,
    };

    // Add tools if provided
    if (tools?.length) {
      requestParams.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
    }

    // Add thinking if enabled
    if (useThinking) {
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
    }

    try {
      const stream = this.client.messages.stream(requestParams, {
        signal: signal ?? undefined,
      });

      // Track tool_use state for accumulating partial JSON input
      let currentToolUseId: string | null = null;
      let currentToolName: string | null = null;
      let toolInputJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolUseId = block.id;
            currentToolName = block.name;
            toolInputJson = '';
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('text' in delta && delta.text) {
            yield { type: 'text', content: delta.text };
          } else if ('thinking' in delta && delta.thinking) {
            yield { type: 'thinking', content: delta.thinking };
          } else if ('partial_json' in delta && typeof delta.partial_json === 'string') {
            toolInputJson += delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolUseId && currentToolName) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = toolInputJson ? JSON.parse(toolInputJson) : {};
            } catch {
              // If JSON parsing fails, wrap raw string as fallback
              parsedInput = { _raw: toolInputJson };
              console.error(`Failed to parse tool input JSON for ${currentToolName}`);
            }
            yield {
              type: 'tool_use',
              toolUseId: currentToolUseId,
              toolName: currentToolName,
              toolInput: parsedInput,
            };
            currentToolUseId = null;
            currentToolName = null;
            toolInputJson = '';
          }
        }
      }

      yield { type: 'done' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: message };
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
