/**
 * Agent Orchestrator (A1).
 * Executes a goal by decomposing it into steps (via Planner) and running tools.
 *
 * Flow: goal → plan → [for each step: select tool → execute → observe] → done
 * The loop continues until all steps complete, an error occurs, or signal is aborted.
 */

import type { Message, MessageContent } from '@neos-work/shared';
import type { LLMProviderAdapter } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import { Planner } from './planner.js';
import type { AgentEvent, AgentStep, AgentTask, OrchestratorOptions } from './types.js';
import { ReflectionStrategy } from './healing.js';
import type { HealingStrategy } from './healing.js';

export class AgentOrchestrator {
  private planner: Planner;
  private maxIterations: number;
  private model: string;
  private reflectionStrategy: HealingStrategy;

  constructor(
    private adapter: LLMProviderAdapter,
    private toolRegistry: ToolRegistry,
    options: OrchestratorOptions = {},
  ) {
    this.planner = new Planner(adapter);
    const rawMax = Number(options.maxIterations ?? 10);
    // Allow 0 (fail immediately after plan) through 200; invalid → default 10
    this.maxIterations =
      Number.isFinite(rawMax) && rawMax >= 0
        ? Math.min(200, Math.floor(rawMax))
        : 10;
    const modelOpt = typeof options.model === 'string' ? options.model.trim() : '';
    this.model = modelOpt || (adapter.getModels()[0]?.id ?? '');
    this.reflectionStrategy = new ReflectionStrategy(adapter);
  }

  /** Cap orchestrator goal text (align with CLI prompt / healing bounds). */
  static readonly GOAL_MAX_CHARS = 50_000;
  /** Cap serialized step results pushed into conversation history. */
  static readonly STEP_RESULT_MAX_CHARS = 32_000;

  async *run(goal: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    let goalText = typeof goal === 'string' ? goal.trim() : String(goal ?? '').trim();
    if (/\0/.test(goalText)) goalText = goalText.replace(/\0/g, '');
    if (goalText.length > AgentOrchestrator.GOAL_MAX_CHARS) {
      goalText =
        goalText.slice(0, AgentOrchestrator.GOAL_MAX_CHARS) +
        '\n…[goal truncated]';
    }
    const task: AgentTask = {
      id: crypto.randomUUID(),
      goal: goalText,
      steps: [],
      status: 'running',
      createdAt: new Date(),
    };

    try {
      if (!goalText) {
        task.status = 'failed';
        yield { type: 'error', error: 'Goal is required' };
        return;
      }

      // Phase 1: Plan
      if (signal?.aborted) {
        task.status = 'cancelled';
        yield { type: 'error', error: 'Cancelled before planning' };
        return;
      }

      const steps = await this.planner.plan(goalText, '', signal);
      task.steps = steps;
      yield { type: 'plan', steps };

      if (steps.length === 0) {
        // No steps — fall back to direct LLM response
        yield* this.directResponse(goalText, signal);
        task.status = 'completed';
        task.completedAt = new Date();
        yield { type: 'done', task };
        return;
      }

      // Phase 2: Execute steps
      const conversationHistory: Message[] = [
        { role: 'user', content: `Goal: ${goalText}` },
      ];
      let iteration = 0;

      for (const step of task.steps) {
        if (signal?.aborted) {
          task.status = 'cancelled';
          yield { type: 'error', error: 'Cancelled during execution' };
          return;
        }

        if (iteration++ >= this.maxIterations) {
          yield { type: 'error', error: 'Max iterations reached' };
          task.status = 'failed';
          return;
        }

        step.status = 'running';
        yield { type: 'step_start', step: { ...step } };

        try {
          const result = await this.executeStep(step, conversationHistory, signal);
          step.output = result;
          step.status = 'completed';

          // Add step result to conversation for context (bounded)
          let resultJson = JSON.stringify(result);
          if (resultJson.length > AgentOrchestrator.STEP_RESULT_MAX_CHARS) {
            resultJson =
              resultJson.slice(0, AgentOrchestrator.STEP_RESULT_MAX_CHARS) +
              '…[truncated]';
          }
          const stepDesc = String(step.description ?? '').slice(0, 500);
          conversationHistory.push({
            role: 'assistant',
            content: `Step ${step.index + 1} (${stepDesc}): ${resultJson}`,
          });

          yield { type: 'step_complete', step: { ...step } };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          let healed = false;

          // Healing attempt 1: retry
          if (!signal?.aborted) {
            step.status = 'running';
            yield { type: 'step_healing', step: { ...step }, strategy: 'retry' };
            try {
              const result = await this.executeStep(step, conversationHistory, signal);
              step.output = result;
              step.status = 'completed';
              conversationHistory.push({
                role: 'assistant',
                content: `Step ${step.index + 1} (${step.description}): ${JSON.stringify(result)}`,
              });
              yield { type: 'step_complete', step: { ...step } };
              healed = true;
            } catch {
              // retry도 실패 → reflection으로 진행
            }
          }

          // Healing attempt 2: reflection
          if (!healed && !signal?.aborted) {
            yield { type: 'step_healing', step: { ...step }, strategy: 'reflect' };
            const reflectResult = await this.reflectionStrategy.heal(
              step, error, task.steps, signal,
            );

            if (reflectResult.action === 'abort') {
              task.status = 'failed';
              yield { type: 'error', error: `Agent aborted: step ${step.index + 1} failed after reflection` };
              return;
            }

            if (reflectResult.action === 'retry' && reflectResult.revisedStep) {
              Object.assign(step, reflectResult.revisedStep);
              step.status = 'running';
              try {
                const result = await this.executeStep(step, conversationHistory, signal);
                step.output = result;
                step.status = 'completed';
                conversationHistory.push({
                  role: 'assistant',
                  content: `Step ${step.index + 1} (${step.description}): ${JSON.stringify(result)}`,
                });
                yield { type: 'step_complete', step: { ...step } };
                healed = true;
              } catch {
                // revised step도 실패 → skip으로 처리
              }
            }
          }

          if (!healed) {
            const finalError = err instanceof Error ? err.message : String(err);
            step.status = 'error';
            step.error = finalError;
            yield { type: 'step_error', step: { ...step }, error: finalError };
            // Non-fatal: 다음 step 계속
          }
        }
      }

      // Phase 3: Synthesize final response
      if (!signal?.aborted) {
        yield* this.synthesizeResult(goalText, task.steps, signal);
      }

      task.status = 'completed';
      task.completedAt = new Date();
      yield { type: 'done', task };
    } catch (err) {
      task.status = 'failed';
      let msg = err instanceof Error ? err.message : String(err);
      if (msg.length > 4_000) msg = msg.slice(0, 4_000);
      yield { type: 'error', error: msg };
    }
  }

  private async executeStep(
    step: AgentStep,
    _history: Message[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const TOOL_CALLS_MAX = 20;
    const TOOL_RESULT_MAX = 64_000;
    // If the step has a known tool, execute it directly
    if (step.toolName && step.input) {
      const result = await this.toolRegistry.execute(step.toolName, step.input);
      if (!result.success) throw new Error(result.error ?? 'Tool execution failed');
      return result.output;
    }

    // Otherwise, use LLM with available tools to figure out what to do
    const toolDefs = this.toolRegistry.toDefinitions();
    const stepDesc = String(step.description ?? '').slice(0, 2_000);
    const messages: Message[] = [
      {
        role: 'user',
        content: `Execute this step: ${stepDesc}`,
      },
    ];

    let fullText = '';
    const toolCalls: { name: string; id: string; input: Record<string, unknown> }[] = [];

    for await (const chunk of this.adapter.chat({
      model: this.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      maxTokens: 2048,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        fullText += chunk.content;
        if (fullText.length > 256_000) {
          fullText = fullText.slice(0, 256_000);
          break;
        }
      } else if (chunk.type === 'tool_use' && chunk.toolName) {
        if (toolCalls.length >= TOOL_CALLS_MAX) continue;
        let name = String(chunk.toolName).trim();
        if (!name || name.length > 200 || /[\0\r\n]/.test(name)) continue;
        toolCalls.push({
          name,
          id: chunk.toolUseId ?? crypto.randomUUID(),
          input:
            chunk.toolInput && typeof chunk.toolInput === 'object' && !Array.isArray(chunk.toolInput)
              ? chunk.toolInput
              : {},
        });
      }
    }

    // Execute any tool calls
    if (toolCalls.length > 0) {
      const results: MessageContent[] = [];
      for (const call of toolCalls) {
        const result = await this.toolRegistry.execute(call.name, call.input);
        let content = result.success
          ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
          : `Error: ${result.error}`;
        if (content.length > TOOL_RESULT_MAX) {
          content = content.slice(0, TOOL_RESULT_MAX) + '…[truncated]';
        }
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content,
        });
      }
      step.input = { toolCalls, results };
      return results;
    }

    return fullText;
  }

  private async *directResponse(goal: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const messages: Message[] = [{ role: 'user', content: goal }];
    for await (const chunk of this.adapter.chat({
      model: this.model,
      messages,
      maxTokens: 4096,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        yield { type: 'text', content: chunk.content };
      }
    }
  }

  private async *synthesizeResult(
    goal: string,
    steps: AgentStep[],
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const completedSteps = steps.filter((s) => s.status === 'completed');
    const summary = completedSteps
      .map((s) => `- ${s.description}: ${JSON.stringify(s.output ?? '(no output)')}`)
      .join('\n');

    const messages: Message[] = [
      {
        role: 'user',
        content: `Goal: ${goal}\n\nCompleted steps:\n${summary}\n\nProvide a concise summary of what was accomplished.`,
      },
    ];

    for await (const chunk of this.adapter.chat({
      model: this.model,
      messages,
      maxTokens: 1024,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        yield { type: 'text', content: chunk.content };
      }
    }
  }
}
