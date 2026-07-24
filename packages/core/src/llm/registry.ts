/**
 * Provider registry — manages available LLM providers.
 */

import type { LLMProvider, Model, ProviderId } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

export class ProviderRegistry {
  private adapters = new Map<ProviderId, LLMProviderAdapter>();

  register(adapter: LLMProviderAdapter): void {
    // Index by trimmed lower-case id so get(' Anthropic ') resolves
    const id =
      typeof adapter.id === 'string' ? adapter.id.trim().toLowerCase() : adapter.id;
    if (!id) return;
    this.adapters.set(id as ProviderId, adapter);
  }

  get(id: ProviderId | string): LLMProviderAdapter | undefined {
    const key = typeof id === 'string' ? id.trim().toLowerCase() : id;
    if (!key) return undefined;
    return this.adapters.get(key as ProviderId);
  }

  getAll(): LLMProvider[] {
    return Array.from(this.adapters.values()).map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      models: adapter.getModels(),
    }));
  }

  getAllModels(): Model[] {
    return this.getAll().flatMap((p) => p.models);
  }

  findModel(modelId: string): { provider: LLMProviderAdapter; model: Model } | undefined {
    const id = typeof modelId === 'string' ? modelId.trim() : '';
    if (!id) return undefined;
    for (const adapter of this.adapters.values()) {
      const model = adapter.getModels().find((m) => m.id === id);
      if (model) return { provider: adapter, model };
    }
    return undefined;
  }
}
