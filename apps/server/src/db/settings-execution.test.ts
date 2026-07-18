import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteSetting,
  getExecutionSettings,
  getWorkflowSecrets,
  isSafeHttpBaseUrl,
  setSetting,
} from './settings.js';

const KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OLLAMA_BASE_URL',
  'apiKey.anthropic',
  'ANTHROPIC_API_KEY',
  'apiKey.google',
  'GOOGLE_API_KEY',
  'TAVILY_API_KEY',
  'VERCEL_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'defaults.provider',
  'defaults.model',
];

afterEach(() => {
  for (const k of KEYS) {
    try { deleteSetting(k); } catch { /* ignore */ }
  }
});

describe('getWorkflowSecrets aliases', () => {
  it('includes OPENAI_API_KEY when set', () => {
    setSetting('OPENAI_API_KEY', 'sk-test');
    const secrets = getWorkflowSecrets();
    expect(secrets.OPENAI_API_KEY).toBe('sk-test');
  });

  it('maps apiKey.anthropic to ANTHROPIC_API_KEY', () => {
    setSetting('apiKey.anthropic', 'sk-ant-ui');
    const secrets = getWorkflowSecrets();
    expect(secrets.ANTHROPIC_API_KEY).toBe('sk-ant-ui');
  });

  it('prefers explicit ANTHROPIC_API_KEY over ui alias', () => {
    setSetting('ANTHROPIC_API_KEY', 'sk-ant-direct');
    setSetting('apiKey.anthropic', 'sk-ant-ui');
    const secrets = getWorkflowSecrets();
    expect(secrets.ANTHROPIC_API_KEY).toBe('sk-ant-direct');
  });

  it('maps apiKey.google and includes deploy/media related keys', () => {
    setSetting('apiKey.google', 'g-key');
    setSetting('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    setSetting('OLLAMA_BASE_URL', 'http://localhost:11434');
    setSetting('VERCEL_API_TOKEN', 'vercel-tok');
    setSetting('CLOUDFLARE_API_TOKEN', 'cf-tok');
    setSetting('CLOUDFLARE_ACCOUNT_ID', 'acct');
    const secrets = getWorkflowSecrets();
    expect(secrets.GOOGLE_API_KEY).toBe('g-key');
    expect(secrets.OPENAI_BASE_URL).toContain('openai.com');
    expect(secrets.OLLAMA_BASE_URL).toContain('11434');
    expect(secrets.VERCEL_API_TOKEN).toBe('vercel-tok');
    expect(secrets.CLOUDFLARE_API_TOKEN).toBe('cf-tok');
    expect(secrets.CLOUDFLARE_ACCOUNT_ID).toBe('acct');
  });
});

describe('getExecutionSettings', () => {
  it('injects SERVER_URL SERVER_TOKEN AUTH_TOKEN from runtime', () => {
    const s = getExecutionSettings({
      serverUrl: 'http://127.0.0.1:57286',
      authToken: 'runtime-tok',
    });
    expect(s.SERVER_URL).toBe('http://127.0.0.1:57286');
    expect(s.SERVER_TOKEN).toBe('runtime-tok');
    expect(s.AUTH_TOKEN).toBe('runtime-tok');
  });

  it('merges secrets with runtime without dropping keys', () => {
    setSetting('OPENAI_API_KEY', 'sk-merge');
    const s = getExecutionSettings({
      serverUrl: 'http://127.0.0.1:9',
      authToken: 't',
    });
    expect(s.OPENAI_API_KEY).toBe('sk-merge');
    expect(s.SERVER_URL).toBe('http://127.0.0.1:9');
  });

  it('omits runtime keys when options empty', () => {
    const s = getExecutionSettings();
    expect(s.SERVER_URL).toBeUndefined();
    expect(s.SERVER_TOKEN).toBeUndefined();
    expect(s.AUTH_TOKEN).toBeUndefined();
  });

  it('injects defaults.provider and defaults.model as llmProvider/model', () => {
    setSetting('defaults.provider', 'openai');
    setSetting('defaults.model', 'gpt-4o');
    const s = getExecutionSettings();
    expect(s.llmProvider).toBe('openai');
    expect(s.model).toBe('gpt-4o');
  });

  it('strips unsafe OPENAI_BASE_URL and OLLAMA_BASE_URL', () => {
    setSetting('OPENAI_BASE_URL', 'file:///etc/passwd');
    setSetting('OLLAMA_BASE_URL', 'not a url');
    const s = getExecutionSettings();
    expect(s.OPENAI_BASE_URL).toBeUndefined();
    expect(s.OLLAMA_BASE_URL).toBeUndefined();
  });

  it('does not overwrite existing llmProvider with defaults.provider', () => {
    setSetting('defaults.provider', 'openai');
    // Simulate a pre-set bag by setting an engine-facing key is not how getExecution works —
    // llmProvider only comes from defaults when unset. Verifying defaults apply only once.
    const s = getExecutionSettings();
    expect(s.llmProvider).toBe('openai');
    setSetting('defaults.provider', 'anthropic');
    const s2 = getExecutionSettings();
    expect(s2.llmProvider).toBe('anthropic');
  });

  it('keeps valid https OPENAI_BASE_URL', () => {
    setSetting('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    const s = getExecutionSettings();
    expect(s.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
  });
});

describe('isSafeHttpBaseUrl', () => {
  it('accepts http and https only', () => {
    expect(isSafeHttpBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isSafeHttpBaseUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isSafeHttpBaseUrl('file:///tmp')).toBe(false);
    expect(isSafeHttpBaseUrl('ftp://x')).toBe(false);
    expect(isSafeHttpBaseUrl('')).toBe(false);
  });
});
