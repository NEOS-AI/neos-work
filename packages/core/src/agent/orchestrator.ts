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

export class AgentOrchestrator {
  private planner: Planner;
  private maxIterations: number;
  private model: string;

  constructor(
    private adapter: LLMProviderAdapter,
    private toolRegistry: ToolRegistry,
    options: OrchestratorOptions = {},
  ) {
    this.planner = new Planner(adapter);
    this.maxIterations = options.maxIterations ?? 10;
    this.model = options.model ?? (adapter.getModels()[0]?.id ?? '');
  }

  async *run(goal: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const task: AgentTask = {
      id: crypto.randomUUID(),
      goal,
      steps: [],
      status: 'running',
      createdAt: new Date(),
    };

    try {
      // Phase 1: Plan
      if (signal?.aborted) {
        task.status = 'cancelled';
        yield { type: 'error', error: 'Cancelled before planning' };
        return;
      }

      const steps = await this.planner.plan(goal, '', signal);
      task.steps = steps;
      yield { type: 'plan', steps };

      if (steps.length === 0) {
        // No steps — fall back to direct LLM response
        yield* this.directResponse(goal, signal);
        task.status = 'completed';
        task.completedAt = new Date();
        yield { type: 'done', task };
        return;
      }

      // Phase 2: Execute steps
      const conversationHistory: Message[] = [
        { role: 'user', content: `Goal: ${goal}` },
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

          // Add step result to conversation for context
          conversationHistory.push({
            role: 'assistant',
            content: `Step ${step.index + 1} (${step.description}): ${JSON.stringify(result)}`,
          });

          yield { type: 'step_complete', step: { ...step } };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          step.status = 'error';
          step.error = error;
          yield { type: 'step_error', step: { ...step }, error };

          // Non-fatal: continue to next step
        }
      }

      // Phase 3: Synthesize final response
      if (!signal?.aborted) {
        yield* this.synthesizeResult(goal, task.steps, signal);
      }

      task.status = 'completed';
      task.completedAt = new Date();
      yield { type: 'done', task };
    } catch (err) {
      task.status = 'failed';
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async executeStep(
    step: AgentStep,
    _history: Message[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    // If the step has a known tool, execute it directly
    if (step.toolName && step.input) {
      const result = await this.toolRegistry.execute(step.toolName, step.input);
      if (!result.success) throw new Error(result.error ?? 'Tool execution failed');
      return result.output;
    }

    // Otherwise, use LLM with available tools to figure out what to do
    const toolDefs = this.toolRegistry.toDefinitions();
    const messages: Message[] = [
      {
        role: 'user',
        content: `Execute this step: ${step.description}`,
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
      } else if (chunk.type === 'tool_use' && chunk.toolName) {
        toolCalls.push({
          name: chunk.toolName,
          id: chunk.toolUseId ?? crypto.randomUUID(),
          input: chunk.toolInput ?? {},
        });
      }
    }

    // Execute any tool calls
    if (toolCalls.length > 0) {
      const results: MessageContent[] = [];
      for (const call of toolCalls) {
        const result = await this.toolRegistry.execute(call.name, call.input);
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: result.success
            ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
            : `Error: ${result.error}`,
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
