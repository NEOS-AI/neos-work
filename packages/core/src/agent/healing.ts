// packages/core/src/agent/healing.ts
import type { AgentStep } from './types.js';
import type { LLMProviderAdapter } from '../llm/provider.js';

export interface HealingResult {
  /** 취할 행동 */
  action: 'retry' | 'skip' | 'abort';
  /** retry 시 LLM이 제안한 수정 내용 */
  revisedStep?: Partial<Pick<AgentStep, 'description' | 'toolName' | 'input'>>;
}

export interface HealingStrategy {
  heal(
    step: AgentStep,
    error: string,
    history: AgentStep[],
    signal?: AbortSignal,
  ): Promise<HealingResult>;
}

/**
 * 단순 재시도 전략.
 * 실패한 step을 그대로 1회 재실행하도록 'retry'를 반환한다.
 * 재시도 실패 여부 판단은 orchestrator가 담당한다.
 */
export class RetryStrategy implements HealingStrategy {
  async heal(): Promise<HealingResult> {
    return { action: 'retry' };
  }
}

/**
 * LLM 반성 전략.
 * 실패 원인과 히스토리를 LLM에 전달해 대안 행동을 결정한다.
 */
export class ReflectionStrategy implements HealingStrategy {
  constructor(private adapter: LLMProviderAdapter) {}

  async heal(
    step: AgentStep,
    error: string,
    history: AgentStep[],
    signal?: AbortSignal,
  ): Promise<HealingResult> {
    // Bound history / input blobs so healing prompts stay small
    const historyStr = history
      .slice(-20)
      .map(
        (s) =>
          `[${s.status}] ${String(s.description ?? '').slice(0, 500)}${
            s.error ? ` (에러: ${String(s.error).slice(0, 300)})` : ''
          }`,
      )
      .join('\n')
      .slice(0, 8_000);

    const inputStr = step.input
      ? JSON.stringify(step.input).slice(0, 2_000)
      : '';

    const prompt = `에이전트 step이 실패했습니다.

목표: ${String(step.description ?? '').slice(0, 1_000)}
${step.toolName ? `툴: ${String(step.toolName).slice(0, 100)}` : ''}
${inputStr ? `입력: ${inputStr}` : ''}
에러: ${typeof error === 'string' ? error.trim().slice(0, 2000) : String(error ?? '').slice(0, 2000)}

완료된 이전 steps:
${historyStr || '(없음)'}

아래 JSON 형식으로만 응답하세요:
{
  "action": "retry" | "skip" | "abort",
  "revisedDescription": "string (optional, retry 시 수정된 목표)",
  "revisedToolName": "string (optional, retry 시 다른 툴)",
  "revisedInput": {} (optional, retry 시 수정된 입력)
}`;

    let response = '';
    for await (const chunk of this.adapter.chat({
      model: this.adapter.getModels()[0]?.id ?? '',
      messages: [{ role: 'user', content: prompt }],
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      }
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { action: 'skip' };

      const parsed = JSON.parse(jsonMatch[0]) as {
        action?: string;
        revisedDescription?: string;
        revisedToolName?: string;
        revisedInput?: Record<string, unknown>;
      };

      const actionRaw =
        typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
      const action: HealingResult['action'] =
        actionRaw === 'retry' || actionRaw === 'abort' ? actionRaw : 'skip';

      const result: HealingResult = { action };
      if (action === 'retry') {
        let desc =
          typeof parsed.revisedDescription === 'string'
            ? parsed.revisedDescription.trim()
            : '';
        // Cap revised description (align with orchestrator step text bounds)
        if (desc.length > 2_000) desc = desc.slice(0, 2_000);
        let tool =
          typeof parsed.revisedToolName === 'string'
            ? parsed.revisedToolName.trim()
            : '';
        // Drop unsafe / overlong tool names → fall back to original
        if (tool && (tool.length > 100 || /[\0\r\n]/.test(tool))) {
          tool = '';
        }
        let input: Record<string, unknown> | undefined =
          parsed.revisedInput &&
          typeof parsed.revisedInput === 'object' &&
          !Array.isArray(parsed.revisedInput)
            ? parsed.revisedInput
            : undefined;
        // Cap revised input payload size
        if (input) {
          try {
            const serialized = JSON.stringify(input);
            if (serialized.length > 16_000) {
              input = { _truncated: true, note: 'revisedInput exceeded 16k' };
            }
          } catch {
            input = undefined;
          }
        }
        result.revisedStep = {
          description: desc || step.description,
          toolName: tool || step.toolName,
          input: input ?? step.input,
        };
      }
      return result;
    } catch {
      return { action: 'skip' };
    }
  }
}
