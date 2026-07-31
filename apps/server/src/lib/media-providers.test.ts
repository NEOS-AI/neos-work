import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMediaConfigPublic,
  defaultProviderForSurface,
  getProviderDef,
  listProviderCatalog,
  mediaStubsAllowed,
  MEDIA_PROVIDER_CATALOG,
  resolveMediaProvider,
} from './media-providers.js';
import { deleteSetting, setSetting } from '../db/settings.js';

const KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'XAI_API_KEY',
  'MEDIA_COMPAT_API_KEY',
  'MEDIA_COMPAT_BASE_URL',
  'GOOGLE_API_KEY',
];

afterEach(() => {
  for (const k of KEYS) {
    try {
      deleteSetting(k);
    } catch {
      /* ignore */
    }
  }
  delete process.env.NEOS_MEDIA_ALLOW_STUBS;
});

describe('media-providers', () => {
  it('catalog has ≥4 non-stub providers and all expected surfaces', () => {
    const nonStub = MEDIA_PROVIDER_CATALOG.filter((p) => !p.isStub);
    expect(nonStub.length).toBeGreaterThanOrEqual(4);
    const surfaces = new Set(MEDIA_PROVIDER_CATALOG.flatMap((p) => p.surfaces));
    expect(surfaces.has('image')).toBe(true);
    expect(surfaces.has('audio')).toBe(true);
    expect(surfaces.has('video')).toBe(true);
  });

  it('stubs disabled by default', () => {
    expect(mediaStubsAllowed()).toBe(false);
    const stub = resolveMediaProvider('stub');
    expect(stub.configured).toBe(false);
    expect(stub.reason).toMatch(/disabled/i);
  });

  it('stubs enabled with NEOS_MEDIA_ALLOW_STUBS=1', () => {
    process.env.NEOS_MEDIA_ALLOW_STUBS = '1';
    expect(mediaStubsAllowed()).toBe(true);
    expect(resolveMediaProvider('stub').configured).toBe(true);
  });

  it('resolves openai when key present', () => {
    setSetting('OPENAI_API_KEY', 'sk-test-media-provider');
    const r = resolveMediaProvider('openai');
    expect(r.configured).toBe(true);
    expect(r.apiKey).toBeTruthy();
  });

  it('azure requires endpoint', () => {
    setSetting('AZURE_OPENAI_API_KEY', 'az-key');
    expect(resolveMediaProvider('azure-openai').configured).toBe(false);
    setSetting('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    expect(resolveMediaProvider('azure-openai').configured).toBe(true);
  });

  it('public config never includes secret values', () => {
    setSetting('OPENAI_API_KEY', 'sk-super-secret-value');
    const pub = buildMediaConfigPublic();
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain('sk-super-secret-value');
    expect(pub.surfaces).toContain('video');
    expect(pub.providers.length).toBeGreaterThanOrEqual(4);
    expect(pub.stubsAllowed).toBe(false);
  });

  it('listProviderCatalog marks configured flags', () => {
    const list = listProviderCatalog();
    expect(list.some((p) => p.id === 'openai')).toBe(true);
    expect(getProviderDef('nope')).toBeUndefined();
  });

  it('defaultProviderForSurface prefers openai for image', () => {
    setSetting('OPENAI_API_KEY', 'sk-def');
    expect(defaultProviderForSurface('image')).toBe('openai');
  });
});
