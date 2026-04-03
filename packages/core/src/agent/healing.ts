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
    const historyStr = history
      .map(
        (s) =>
          `[${s.status}] ${s.description}${s.error ? ` (에러: ${s.error})` : ''}`,
      )
      .join('\n');

    const prompt = `에이전트 step이 실패했습니다.

목표: ${step.description}
${step.toolName ? `툴: ${step.toolName}` : ''}
${step.input ? `입력: ${JSON.stringify(step.input)}` : ''}
에러: ${error}

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

      const action = (parsed.action === 'retry' || parsed.action === 'abort')
        ? parsed.action
        : 'skip';

      const result: HealingResult = { action };
      if (action === 'retry') {
        result.revisedStep = {
          description: parsed.revisedDescription ?? step.description,
          toolName: parsed.revisedToolName ?? step.toolName,
          input: parsed.revisedInput ?? step.input,
        };
      }
      return result;
    } catch {
      return { action: 'skip' };
    }
  }
}
