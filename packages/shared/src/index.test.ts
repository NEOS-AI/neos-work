import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GOOGLE_MODELS,
  THINKING_BUDGET,
} from './index.js';

describe('@neos-work/shared barrel exports', () => {
  it('re-exports model catalogs and thinking budgets', () => {
    expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
    expect(GOOGLE_MODELS.length).toBeGreaterThan(0);
    expect(THINKING_BUDGET).toBeTypeOf('object');
    expect(ANTHROPIC_MODELS[0]).toMatchObject({
      id: expect.any(String),
      providerId: 'anthropic',
    });
  });
});
