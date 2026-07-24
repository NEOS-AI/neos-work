// packages/core/src/llm/context-manager.ts
import type { Message } from '@neos-work/shared';
import type { LLMProviderAdapter } from './provider.js';

const DEFAULT_THRESHOLD = 80_000; // 토큰
const RECENT_WINDOW = 20; // 항상 보존할 최근 메시지 수
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 2_000_000;

function clampThreshold(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_THRESHOLD;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.floor(raw)));
}

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ('text' in block && typeof (block as { text?: unknown }).text === 'string') {
          chars += (block as { text: string }).text.length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

export class ContextManager {
  private threshold: number;

  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = clampThreshold(threshold);
  }

  needsCompression(messages: Message[]): boolean {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    return estimateTokens(messages) > this.threshold;
  }

  async compress(
    messages: Message[],
    adapter: LLMProviderAdapter,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    if (!Array.isArray(messages)) return [];
    if (messages.length <= RECENT_WINDOW) return messages;

    const recent = messages.slice(-RECENT_WINDOW);
    const older = messages.slice(0, -RECENT_WINDOW);

    const summaryText = await this.summarize(older, adapter, signal);

    const summaryMessage: Message = {
      role: 'system',
      content: `[이전 대화 요약]\n${summaryText}`,
    };

    return [summaryMessage, ...recent];
  }

  private async summarize(
    messages: Message[],
    adapter: LLMProviderAdapter,
    signal?: AbortSignal,
  ): Promise<string> {
    const transcript = messages
      .map((m) => {
        const role = typeof m.role === 'string' ? m.role.trim() || 'unknown' : 'unknown';
        const text =
          typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content);
        return `${role}: ${text}`;
      })
      .join('\n');

    let summary = '';
    for await (const chunk of adapter.chat({
      model: adapter.getModels()[0]?.id ?? '',
      messages: [
        {
          role: 'user',
          content: `다음 대화를 핵심 사실·결정 사항 위주로 간결하게 요약해줘:\n\n${transcript}`,
        },
      ],
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        summary += chunk.content;
      }
    }
    return summary.trim();
  }
}
