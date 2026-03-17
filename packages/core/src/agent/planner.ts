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
    const userContent = context
      ? `Goal: ${goal}\n\nContext:\n${context}`
      : `Goal: ${goal}`;

    const messages: Message[] = [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    let rawOutput = '';
    for await (const chunk of this.adapter.chat({
      model: this.adapter.getModels()[0]?.id ?? '',
      messages,
      maxTokens: 1024,
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        rawOutput += chunk.content;
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
      return [{ description: raw.trim() || 'Execute the goal directly' }];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
        )
        .map((item) => ({
          description: typeof item['description'] === 'string' ? item['description'] : String(item),
          toolName: typeof item['toolName'] === 'string' ? item['toolName'] : undefined,
        }));
    } catch {
      return [{ description: 'Execute the goal directly' }];
    }
  }
}
