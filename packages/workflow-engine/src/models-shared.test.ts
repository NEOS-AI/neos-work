import { describe, expect, it } from 'vitest';
import {
  ALL_MODELS,
  ANTHROPIC_MODELS,
  GOOGLE_MODELS,
  OLLAMA_PRESET_MODELS,
  OPENAI_MODELS,
  THINKING_BUDGET,
  THINKING_MODES,
} from '@neos-work/shared';

describe('shared model catalogs', () => {
  it('exports non-empty provider model lists with required fields', () => {
    for (const list of [ANTHROPIC_MODELS, GOOGLE_MODELS, OPENAI_MODELS, OLLAMA_PRESET_MODELS]) {
      expect(list.length).toBeGreaterThan(0);
      for (const m of list) {
        expect(m.id).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.providerId).toBeTruthy();
        expect(m.contextWindow).toBeGreaterThan(0);
      }
    }
  });

  it('uses unique model ids within each provider list', () => {
    for (const list of [ANTHROPIC_MODELS, GOOGLE_MODELS, OPENAI_MODELS, OLLAMA_PRESET_MODELS]) {
      const ids = list.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('ALL_MODELS concatenates provider catalogs with unique ids', () => {
    expect(ALL_MODELS.length).toBe(
      ANTHROPIC_MODELS.length +
        GOOGLE_MODELS.length +
        OPENAI_MODELS.length +
        OLLAMA_PRESET_MODELS.length,
    );
    const ids = ALL_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('THINKING_BUDGET covers all modes with non-decreasing budgets', () => {
    expect(THINKING_MODES).toEqual(['none', 'low', 'medium', 'high']);
    expect(THINKING_BUDGET.none).toBe(0);
    expect(THINKING_BUDGET.low).toBeLessThan(THINKING_BUDGET.medium);
    expect(THINKING_BUDGET.medium).toBeLessThan(THINKING_BUDGET.high);
  });
});
