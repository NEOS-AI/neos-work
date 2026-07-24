/**
 * Provider registry — manages available LLM providers.
 */

import type { LLMProvider, Model, ProviderId } from '@neos-work/shared';

import type { LLMProviderAdapter } from './provider.js';

/** Cap provider / model id strings (lookup hygiene). */
const PROVIDER_ID_MAX = 50;
const MODEL_ID_MAX = 200;

function normalizeProviderId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim().toLowerCase();
  if (!id || id.length > PROVIDER_ID_MAX) return '';
  return id;
}

function normalizeModelId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > MODEL_ID_MAX) return '';
  return id;
}

export class ProviderRegistry {
  private adapters = new Map<ProviderId, LLMProviderAdapter>();

  register(adapter: LLMProviderAdapter): void {
    // Index by trimmed lower-case id so get(' Anthropic ') resolves
    const id = normalizeProviderId(adapter.id);
    if (!id) return;
    this.adapters.set(id as ProviderId, adapter);
  }

  get(id: ProviderId | string): LLMProviderAdapter | undefined {
    const key = normalizeProviderId(id);
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
    const id = normalizeModelId(modelId);
    if (!id) return undefined;
    for (const adapter of this.adapters.values()) {
      const model = adapter.getModels().find((m) => m.id === id);
      if (model) return { provider: adapter, model };
    }
    return undefined;
  }
}
