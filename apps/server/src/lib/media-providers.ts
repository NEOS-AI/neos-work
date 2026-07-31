/**
 * Media multi-provider catalog (PLAN_FOR_V0_5_0 Task 8 / M4).
 *
 * Surfaces: image | audio | video
 * Providers: openai, azure-openai, google, xai, openai-compatible, stub
 * Stub generation is OFF unless NEOS_MEDIA_ALLOW_STUBS=1.
 */

import { getSecretSetting } from '../db/settings.js';
import { isSafeHttpBaseUrl } from '../db/settings.js';

export type MediaSurface = 'image' | 'audio' | 'video';

export type MediaProviderId =
  | 'openai'
  | 'azure-openai'
  | 'google'
  | 'xai'
  | 'openai-compatible'
  | 'stub';

export interface MediaProviderDef {
  id: MediaProviderId;
  label: string;
  surfaces: MediaSurface[];
  /** Models advertised per surface (catalog). */
  models: Partial<Record<MediaSurface, string[]>>;
  apiKeySetting?: string;
  baseUrlSetting?: string;
  defaultBaseUrl?: string;
  requiresBaseUrl?: boolean;
  isStub?: boolean;
}

export const MEDIA_PROVIDER_CATALOG: MediaProviderDef[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    surfaces: ['image', 'audio'],
    models: {
      image: ['dall-e-3'],
      audio: ['tts-1', 'tts-1-hd'],
    },
    apiKeySetting: 'OPENAI_API_KEY',
    baseUrlSetting: 'OPENAI_BASE_URL',
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    surfaces: ['image', 'audio'],
    models: {
      image: ['dall-e-3'],
      audio: ['tts-1', 'tts-1-hd'],
    },
    apiKeySetting: 'AZURE_OPENAI_API_KEY',
    baseUrlSetting: 'AZURE_OPENAI_ENDPOINT',
    requiresBaseUrl: true,
  },
  {
    id: 'google',
    label: 'Google',
    surfaces: ['image'],
    models: {
      image: ['imagen-3.0-generate-002'],
    },
    apiKeySetting: 'GOOGLE_API_KEY',
  },
  {
    id: 'xai',
    label: 'xAI',
    surfaces: ['image', 'video'],
    models: {
      image: ['grok-2-image'],
      video: ['grok-video'],
    },
    apiKeySetting: 'XAI_API_KEY',
    baseUrlSetting: 'XAI_BASE_URL',
    defaultBaseUrl: 'https://api.x.ai/v1',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    surfaces: ['image', 'audio'],
    models: {
      image: ['dall-e-3'],
      audio: ['tts-1', 'tts-1-hd'],
    },
    apiKeySetting: 'MEDIA_COMPAT_API_KEY',
    baseUrlSetting: 'MEDIA_COMPAT_BASE_URL',
    requiresBaseUrl: true,
  },
  {
    id: 'stub',
    label: 'Stub (dev)',
    surfaces: ['image', 'audio', 'video'],
    models: {
      image: ['stub-image'],
      audio: ['stub-audio'],
      video: ['stub-video'],
    },
    isStub: true,
  },
];

export function mediaStubsAllowed(): boolean {
  const v = process.env.NEOS_MEDIA_ALLOW_STUBS;
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

export function getProviderDef(id: string): MediaProviderDef | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const key = id.trim().toLowerCase();
  return MEDIA_PROVIDER_CATALOG.find((p) => p.id === key);
}

export interface ResolvedMediaProvider {
  def: MediaProviderDef;
  configured: boolean;
  apiKey?: string;
  baseURL?: string;
  reason?: string;
}

function safeKey(raw: string | undefined): string | undefined {
  if (!raw || /[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim();
  return t || undefined;
}

export function resolveMediaProvider(id: string): ResolvedMediaProvider {
  const def = getProviderDef(id);
  if (!def) {
    return {
      def: MEDIA_PROVIDER_CATALOG[0]!,
      configured: false,
      reason: `Unknown media provider: ${String(id).slice(0, 40)}`,
    };
  }

  if (def.isStub) {
    if (!mediaStubsAllowed()) {
      return {
        def,
        configured: false,
        reason: 'Stub media provider is disabled (set NEOS_MEDIA_ALLOW_STUBS=1)',
      };
    }
    return { def, configured: true };
  }

  const apiKey = def.apiKeySetting ? safeKey(getSecretSetting(def.apiKeySetting)) : undefined;
  let baseURL: string | undefined;
  if (def.baseUrlSetting) {
    const raw = safeKey(getSecretSetting(def.baseUrlSetting));
    if (raw && isSafeHttpBaseUrl(raw)) baseURL = raw.replace(/\/+$/, '');
  }
  if (!baseURL && def.defaultBaseUrl && isSafeHttpBaseUrl(def.defaultBaseUrl)) {
    baseURL = def.defaultBaseUrl.replace(/\/+$/, '');
  }

  if (!apiKey) {
    return {
      def,
      configured: false,
      reason: def.apiKeySetting
        ? `${def.apiKeySetting} is not configured`
        : 'API key not configured',
    };
  }
  if (def.requiresBaseUrl && !baseURL) {
    return {
      def,
      configured: false,
      apiKey,
      reason: def.baseUrlSetting
        ? `${def.baseUrlSetting} is required`
        : 'Base URL is required',
    };
  }

  return { def, configured: true, apiKey, baseURL };
}

/** Default provider for a surface when client omits provider. */
export function defaultProviderForSurface(surface: MediaSurface): MediaProviderId {
  if (surface === 'video') {
    const xai = resolveMediaProvider('xai');
    if (xai.configured) return 'xai';
    if (mediaStubsAllowed()) return 'stub';
    return 'xai';
  }
  const openai = resolveMediaProvider('openai');
  if (openai.configured) return 'openai';
  for (const id of ['azure-openai', 'openai-compatible', 'google', 'xai'] as MediaProviderId[]) {
    if (resolveMediaProvider(id).configured) return id;
  }
  if (mediaStubsAllowed()) return 'stub';
  return 'openai';
}

export interface ProviderCatalogEntry {
  id: MediaProviderId;
  label: string;
  surfaces: MediaSurface[];
  models: Partial<Record<MediaSurface, string[]>>;
  configured: boolean;
  isStub?: boolean;
  requiresBaseUrl?: boolean;
  /** Secret setting names only — never values. */
  settings: { apiKey?: string; baseUrl?: string };
}

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return MEDIA_PROVIDER_CATALOG.map((def) => {
    const resolved = resolveMediaProvider(def.id);
    return {
      id: def.id,
      label: def.label,
      surfaces: [...def.surfaces],
      models: { ...def.models },
      configured: resolved.configured,
      isStub: def.isStub,
      requiresBaseUrl: def.requiresBaseUrl,
      settings: {
        apiKey: def.apiKeySetting,
        baseUrl: def.baseUrlSetting,
      },
    };
  });
}

/** Build public /config payload (no secrets). */
export function buildMediaConfigPublic() {
  const providers = listProviderCatalog();
  const openai = resolveMediaProvider('openai');
  const stubsAllowed = mediaStubsAllowed();
  const surfaces: MediaSurface[] = ['image', 'audio', 'video'];
  const imageModels = [
    ...new Set(providers.flatMap((p) => p.models.image ?? [])),
  ];
  const audioModels = [
    ...new Set(providers.flatMap((p) => p.models.audio ?? [])),
  ];
  const videoModels = [
    ...new Set(providers.flatMap((p) => p.models.video ?? [])),
  ];
  return {
    openaiConfigured: openai.configured,
    openaiBaseUrl: openai.baseURL ?? null,
    surfaces,
    imageModels,
    audioModels,
    videoModels,
    stubsAllowed,
    providers,
  };
}
