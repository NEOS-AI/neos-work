/**
 * Provider registry — manages available LLM providers.
 */

import type { LLMProvider, Model, ProviderId } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

export class ProviderRegistry {
  private adapters = new Map<ProviderId, LLMProviderAdapter>();

  register(adapter: LLMProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: ProviderId): LLMProviderAdapter | undefined {
    return this.adapters.get(id);
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
    for (const adapter of this.adapters.values()) {
      const model = adapter.getModels().find((m) => m.id === modelId);
      if (model) return { provider: adapter, model };
    }
    return undefined;
  }
}
