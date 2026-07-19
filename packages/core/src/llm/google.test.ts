import { describe, expect, it } from 'vitest';
import { GOOGLE_MODELS } from '@neos-work/shared';
import { GoogleAdapter } from './google.js';

describe('GoogleAdapter', () => {
  it('exposes provider id/name and shared model catalog', () => {
    const adapter = new GoogleAdapter('sk-test');
    expect(adapter.id).toBe('google');
    expect(adapter.name).toBe('Google AI');
    expect(adapter.getModels()).toEqual(GOOGLE_MODELS);
    expect(adapter.getModels().length).toBeGreaterThan(0);
  });
});
