/**
 * OpenAI (and OpenAI-compatible, e.g. Ollama) LLM provider adapter.
 * Uses the /v1/chat/completions streaming endpoint.
 */

import type { ChatChunk, ChatParams, Model, ProviderId } from '@neos-work/shared';
import { OLLAMA_PRESET_MODELS, OPENAI_MODELS } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

export type OpenAICompatibleProvider = 'openai' | 'ollama';

export class OpenAIAdapter implements LLMProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(options: {
    provider: OpenAICompatibleProvider;
    apiKey?: string;
    baseUrl?: string;
  }) {
    this.id = options.provider;
    this.name = options.provider === 'openai' ? 'OpenAI' : 'Ollama';
    this.apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    const base =
      typeof options.baseUrl === 'string' ? options.baseUrl.trim() : '';
    this.baseUrl =
      base
      || (options.provider === 'ollama'
        ? 'http://localhost:11434/v1'
        : 'https://api.openai.com/v1');
    // Strip trailing slash for consistent request paths
    this.baseUrl = this.baseUrl.replace(/\/+$/, '');
  }

  getModels(): Model[] {
    return this.id === 'openai' ? OPENAI_MODELS : OLLAMA_PRESET_MODELS;
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (this.id === 'ollama') return true; // Ollama runs locally, no key needed
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk, void, unknown> {
    const { model, messages, tools, maxTokens = 4096, signal } = params;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Build message array
    const oaiMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    // Build request body
    const body: Record<string, unknown> = {
      model,
      messages: oaiMessages,
      max_tokens: maxTokens,
      stream: true,
    };

    if (tools?.length) {
      body['tools'] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
      body['tool_choice'] = 'auto';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal ?? undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: 'error', content: `OpenAI request failed: ${message}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      yield { type: 'error', content: `OpenAI error ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', content: 'Empty response body' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Accumulate partial tool-call arguments
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') break;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            continue;
          }

          const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
          if (!choices?.length) continue;

          const delta = choices[0]['delta'] as Record<string, unknown> | undefined;
          if (!delta) continue;

          // Text content
          if (typeof delta['content'] === 'string' && delta['content']) {
            yield { type: 'text', content: delta['content'] };
          }

          // Tool calls
          const toolCallsRaw = delta['tool_calls'] as
            | Array<Record<string, unknown>>
            | undefined;
          if (toolCallsRaw?.length) {
            for (const tc of toolCallsRaw) {
              const idx = tc['index'] as number;
              const fn = tc['function'] as Record<string, unknown> | undefined;

              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, {
                  id: (tc['id'] as string) ?? `call_${idx}`,
                  name: (fn?.['name'] as string) ?? '',
                  args: '',
                });
              }

              const pending = pendingToolCalls.get(idx)!;
              if (fn?.['name']) pending.name = fn['name'] as string;
              if (typeof fn?.['arguments'] === 'string') {
                pending.args += fn['arguments'];
              }
            }
          }

          // Check for finish_reason
          const finishReason = choices[0]['finish_reason'] as string | null;
          if (finishReason === 'tool_calls') {
            for (const [, tc] of pendingToolCalls) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(tc.args) as Record<string, unknown>;
              } catch {
                // best effort
              }
              yield {
                type: 'tool_use',
                toolUseId: tc.id,
                toolName: tc.name,
                toolInput: input,
              };
            }
            pendingToolCalls.clear();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }
}
