import { describe, expect, it } from 'vitest';
import type { Model } from '@neos-work/shared';
import { ProviderRegistry } from './registry.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';

const modelA: Model = {
  id: 'a-1',
  name: 'A1',
  providerId: 'anthropic',
  contextWindow: 100,
  supportsThinking: true,
  supportsTools: true,
  supportsVision: true,
};
const modelB: Model = {
  id: 'b-1',
  name: 'B1',
  providerId: 'openai',
  contextWindow: 200,
  supportsThinking: false,
  supportsTools: true,
  supportsVision: false,
};

describe('ProviderRegistry', () => {
  it('registers adapters and lists providers/models', () => {
    const reg = new ProviderRegistry();
    reg.register(mockAdapter([''], { id: 'anthropic', models: [modelA] }));
    reg.register(mockAdapter([''], { id: 'openai', models: [modelB] }));

    expect(reg.get('anthropic')?.name).toBe('Mock');
    expect(reg.getAll()).toHaveLength(2);
    expect(reg.getAllModels().map((m) => m.id).sort()).toEqual(['a-1', 'b-1']);
  });

  it('findModel locates provider by model id', () => {
    const reg = new ProviderRegistry();
    reg.register(mockAdapter([''], { id: 'openai', models: [modelB] }));
    const hit = reg.findModel('b-1');
    expect(hit?.model).toEqual(modelB);
    expect(hit?.provider.id).toBe('openai');
    expect(reg.findModel('missing')).toBeUndefined();
  });
});
