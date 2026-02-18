/**
 * Google AI (Gemini) LLM provider adapter.
 */

import { GoogleGenAI } from '@google/genai';
import type { ChatChunk, ChatParams, Model } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

const MODELS: Model[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    providerId: 'google',
    contextWindow: 1000000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.0-pro',
    name: 'Gemini 2.0 Pro',
    providerId: 'google',
    contextWindow: 1000000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
];

export class GoogleAdapter implements LLMProviderAdapter {
  readonly id = 'google' as const;
  readonly name = 'Google AI';
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  getModels(): Model[] {
    return MODELS;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk, void, unknown> {
    const { model, messages, tools, maxTokens = 4096, thinkingMode = 'none' } = params;

    // Convert messages to Gemini format
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemInstruction = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));

    const useThinking = thinkingMode !== 'none';
    const thinkingBudget =
      thinkingMode === 'low' ? 1024 : thinkingMode === 'medium' ? 4096 : 16384;

    try {
      const stream = await this.client.models.generateContentStream({
        model,
        contents,
        config: {
          maxOutputTokens: maxTokens,
          systemInstruction: systemInstruction || undefined,
          thinkingConfig: useThinking ? { thinkingBudget } : undefined,
          ...(tools?.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.inputSchema,
                    })),
                  },
                ],
              }
            : {}),
        },
      });

      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if (part.thought && part.text) {
            yield { type: 'thinking', content: part.text };
          } else if (part.functionCall) {
            yield {
              type: 'tool_use' as const,
              toolName: part.functionCall.name,
              toolInput: (part.functionCall.args ?? {}) as Record<string, unknown>,
            };
          } else if (part.text) {
            yield { type: 'text', content: part.text };
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
      const client = new GoogleGenAI({ apiKey });
      await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'hi',
        config: { maxOutputTokens: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }
}
