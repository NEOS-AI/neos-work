import { describe, expect, it } from 'vitest';
import {
  ALL_MODELS,
  ANTHROPIC_MODELS,
  GOOGLE_MODELS,
  OLLAMA_PRESET_MODELS,
  OPENAI_MODELS,
  THINKING_BUDGET,
  THINKING_MODES,
} from './models.js';

describe('shared model catalog', () => {
  it('ALL_MODELS is the concatenation of provider lists', () => {
    expect(ALL_MODELS).toEqual([
      ...ANTHROPIC_MODELS,
      ...GOOGLE_MODELS,
      ...OPENAI_MODELS,
      ...OLLAMA_PRESET_MODELS,
    ]);
  });

  it('each model has required identity fields and matching providerId', () => {
    for (const model of ALL_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(typeof model.supportsThinking).toBe('boolean');
      expect(typeof model.supportsTools).toBe('boolean');
      expect(typeof model.supportsVision).toBe('boolean');
      expect(['anthropic', 'google', 'openai', 'ollama']).toContain(model.providerId);
    }
  });

  it('model ids are unique across the catalog', () => {
    const ids = ALL_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('provider groups use consistent providerId', () => {
    expect(ANTHROPIC_MODELS.every((m) => m.providerId === 'anthropic')).toBe(true);
    expect(GOOGLE_MODELS.every((m) => m.providerId === 'google')).toBe(true);
    expect(OPENAI_MODELS.every((m) => m.providerId === 'openai')).toBe(true);
    expect(OLLAMA_PRESET_MODELS.every((m) => m.providerId === 'ollama')).toBe(true);
  });

  it('THINKING_BUDGET covers every thinking mode with non-negative budgets', () => {
    expect(THINKING_MODES).toEqual(['none', 'low', 'medium', 'high']);
    for (const mode of THINKING_MODES) {
      expect(THINKING_BUDGET[mode]).toBeGreaterThanOrEqual(0);
    }
    expect(THINKING_BUDGET.none).toBe(0);
    expect(THINKING_BUDGET.high).toBeGreaterThan(THINKING_BUDGET.medium);
    expect(THINKING_BUDGET.medium).toBeGreaterThan(THINKING_BUDGET.low);
  });
});
