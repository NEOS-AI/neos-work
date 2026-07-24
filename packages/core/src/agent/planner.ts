/**
 * Agent Planner (A2).
 * Uses an LLM to decompose a high-level goal into ordered, concrete steps.
 */

import type { Message } from '@neos-work/shared';
import type { LLMProviderAdapter } from '../llm/provider.js';
import type { AgentStep } from './types.js';

const PLANNER_SYSTEM_PROMPT = `You are a task planner. Given a user goal, decompose it into ordered, concrete steps.

Rules:
- Each step must be a single, actionable unit of work
- Be specific about what tool or action each step requires
- Keep steps minimal — avoid over-engineering
- Return ONLY a valid JSON array, no markdown, no explanation

Output format:
[
  {
    "description": "Brief description of what to do",
    "toolName": "optional_tool_name_if_applicable"
  }
]`;

export interface PlannerStep {
  description: string;
  toolName?: string;
}

export class Planner {
  constructor(private adapter: LLMProviderAdapter) {}

  async plan(
    goal: string,
    context: string = '',
    signal?: AbortSignal,
  ): Promise<AgentStep[]> {
    /** Cap planner goal/context (align with orchestrator goal bound). */
    const GOAL_MAX = 50_000;
    const CONTEXT_MAX = 32_000;
    let goalText = typeof goal === 'string' ? goal.trim() : String(goal ?? '').trim();
    let contextText =
      typeof context === 'string' ? context.trim() : String(context ?? '').trim();
    // Drop null bytes that break prompts
    if (/\0/.test(goalText)) goalText = goalText.replace(/\0/g, '');
    if (/\0/.test(contextText)) contextText = contextText.replace(/\0/g, '');
    if (goalText.length > GOAL_MAX) goalText = goalText.slice(0, GOAL_MAX);
    if (contextText.length > CONTEXT_MAX) {
      contextText = contextText.slice(0, CONTEXT_MAX) + '\n…[context truncated]';
    }

    if (!goalText) {
      return [
        {
          id: crypto.randomUUID(),
          index: 0,
          description: 'Execute the goal directly',
          type: 'plan' as const,
          status: 'pending' as const,
        },
      ];
    }

    const userContent = contextText
      ? `Goal: ${goalText}\n\nContext:\n${contextText}`
      : `Goal: ${goalText}`;

    const messages: Message[] = [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    /** Cap raw planner LLM output so parseSteps cannot receive multi-MiB dumps. */
    const RAW_OUTPUT_MAX = 500_000;
    let rawOutput = '';
    for await (const chunk of this.adapter.chat({
      model: this.adapter.getModels()[0]?.id ?? '',
      messages,
      maxTokens: 1024,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        rawOutput += chunk.content;
        if (rawOutput.length > RAW_OUTPUT_MAX) {
          rawOutput = rawOutput.slice(0, RAW_OUTPUT_MAX);
          break;
        }
      }
    }

    const plannerSteps = this.parseSteps(rawOutput);
    return plannerSteps.map((s, index) => ({
      id: crypto.randomUUID(),
      index,
      description: s.description,
      type: 'plan' as const,
      status: 'pending' as const,
      toolName: s.toolName,
    }));
  }

  private parseSteps(raw: string): PlannerStep[] {
    // Extract JSON array from the response (handle potential markdown code blocks)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      const fallback = (raw.trim() || 'Execute the goal directly').slice(0, 2_000);
      return [{ description: fallback }];
    }

    try {
      // Cap JSON blob size before parse (pathological nested arrays)
      const JSON_BLOB_MAX = 500_000;
      const jsonBlob =
        jsonMatch[0]!.length > JSON_BLOB_MAX
          ? jsonMatch[0]!.slice(0, JSON_BLOB_MAX)
          : jsonMatch[0]!;
      const parsed = JSON.parse(jsonBlob) as unknown[];
      if (!Array.isArray(parsed)) return [];

      // Cap step count so runaway planner JSON cannot bloat the orchestrator
      const MAX_PLAN_STEPS = 50;
      return parsed
        .filter((item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
        )
        .slice(0, MAX_PLAN_STEPS)
        .map((item) => {
          const descriptionRaw =
            typeof item['description'] === 'string'
              ? item['description'].trim()
              : String(item ?? '').trim();
          let toolRaw =
            typeof item['toolName'] === 'string' ? item['toolName'].trim() : '';
          // Drop control-char tool names; truncate overlong names
          if (toolRaw && /[\0\r\n]/.test(toolRaw)) {
            toolRaw = '';
          } else if (toolRaw.length > 100) {
            toolRaw = toolRaw.slice(0, 100);
          }
          // Cap description length
          const description = (descriptionRaw || 'Execute the goal directly').slice(0, 2_000);
          return {
            description,
            toolName: toolRaw || undefined,
          };
        })
        .filter((s) => s.description.length > 0);
    } catch {
      return [{ description: 'Execute the goal directly' }];
    }
  }
}
