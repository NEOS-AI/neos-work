/**
 * Google AI (Gemini) LLM provider adapter.
 */

import { GoogleGenAI } from '@google/genai';
import type { ChatChunk, ChatParams, Model } from '@neos-work/shared';
import { GOOGLE_MODELS, THINKING_BUDGET } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

export class GoogleAdapter implements LLMProviderAdapter {
  readonly id = 'google' as const;
  readonly name = 'Google AI';
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key || key.length > 8_192 || /[\0\r\n]/.test(key)) {
      throw new Error('GOOGLE_API_KEY is required');
    }
    this.client = new GoogleGenAI({ apiKey: key });
  }

  getModels(): Model[] {
    return GOOGLE_MODELS;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk, void, unknown> {
    const { tools, thinkingMode = 'none', signal } = params;
    // Clamp model id (control chars / overlong → first known model)
    let model = typeof params.model === 'string' ? params.model.trim() : '';
    if (!model || /[\0\r\n]/.test(model) || model.length > 200) {
      model = this.getModels()[0]?.id ?? 'gemini-2.0-flash';
    }
    // Clamp maxTokens (invalid → 4096; hard cap 128k)
    const rawMax = Number(params.maxTokens ?? 4096);
    const maxTokens =
      Number.isFinite(rawMax) && rawMax >= 1
        ? Math.min(128_000, Math.floor(rawMax))
        : 4096;

    // Convert messages to Gemini format
    const messages = Array.isArray(params.messages) ? params.messages.slice(0, 200) : [];
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');
    const SYS_MAX = 100_000;
    const MSG_MAX = 500_000;

    let systemInstruction = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    if (systemInstruction.length > SYS_MAX) {
      systemInstruction = systemInstruction.slice(0, SYS_MAX);
    }

    const contents = conversationMessages.map((m) => {
      let text =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (text.length > MSG_MAX) text = text.slice(0, MSG_MAX) + '…[truncated]';
      return {
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text }],
      };
    });

    const useThinking = thinkingMode !== 'none';
    const thinkingBudget = THINKING_BUDGET[thinkingMode] || THINKING_BUDGET.high;

    try {
      const stream = await this.client.models.generateContentStream({
        model,
        contents,
        config: {
          maxOutputTokens: maxTokens,
          systemInstruction: systemInstruction || undefined,
          thinkingConfig: useThinking ? { thinkingBudget } : undefined,
          abortSignal: signal ?? undefined,
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
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) return false;
    try {
      const client = new GoogleGenAI({ apiKey: key });
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
