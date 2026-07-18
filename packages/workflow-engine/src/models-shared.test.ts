import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODELS,
  GOOGLE_MODELS,
  OLLAMA_PRESET_MODELS,
  OPENAI_MODELS,
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
});
