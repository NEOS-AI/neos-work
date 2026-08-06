import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isCanvasOverlayEnabled,
  writeCanvasOverlayPref,
} from '@neos-work/design-editor';
import { McpInstallPanel, type McpInstallInfo } from '@neos-work/ui-app';

import { useEngine } from '../hooks/useEngine.js';
import { useTheme } from '../hooks/useTheme.js';
import type { ThemeMode } from '../hooks/useTheme.js';
import type { McpServerData } from '../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatEngineUptime } from '../lib/format-uptime.js';

export function Settings() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { client } = useEngine();
  const { theme, setTheme } = useTheme();
  const [canvasOverlay, setCanvasOverlay] = useState(() => isCanvasOverlayEnabled());

  // Default provider / model
  const [defaultProvider, setDefaultProvider] = useState('anthropic');
  const [defaultModel, setDefaultModel] = useState('claude-sonnet-4-5-20250929');

  // Load saved defaults from server
  useEffect(() => {
    if (!client) return;
    client
      .getSettings()
      .then((res) => {
        if (!res.ok || !res.data) return;
        const provider = res.data['defaults.provider'];
        if (typeof provider === 'string' && !/[\0\r\n]/.test(provider)) {
          const p = provider.trim();
          if (p) setDefaultProvider(p);
        }
        const model = res.data['defaults.model'];
        if (typeof model === 'string' && !/[\0\r\n]/.test(model)) {
          const m = model.trim();
          if (m) setDefaultModel(m);
        }
      })
      .catch(() => {
        // Keep built-in defaults when settings are unavailable
      });
  }, [client]);

  const handleSaveDefault = async (key: string, value: string) => {
    if (!client) return;
    try {
      const res = await client.saveSetting(key, value);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Save failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed',
      );
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('settings:title')}</h1>

      <EngineStatusSection />
      <CollabStatusSection />
      <ConnectionProbeSection />

      {/* API Keys */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('settings:apiKeys.title')}
        </h2>
        <div className="flex flex-col gap-4">
          <ApiKeyInput
            label={t('settings:apiKeys.anthropic')}
            placeholder="sk-ant-..."
            provider="anthropic"
            settingKey="apiKey.anthropic"
          />
          <ApiKeyInput
            label={t('settings:apiKeys.google')}
            placeholder="AIza..."
            provider="google"
            settingKey="apiKey.google"
          />
          <ApiKeyInput
            label="OpenAI API Key"
            placeholder="sk-..."
            provider="openai"
            settingKey="OPENAI_API_KEY"
          />
          <SimpleKeyInput
            label="OpenAI Base URL"
            placeholder="https://api.openai.com/v1"
            settingKey="OPENAI_BASE_URL"
          />
          <SimpleKeyInput
            label="Azure OpenAI API Key"
            placeholder="..."
            settingKey="AZURE_OPENAI_API_KEY"
          />
          <SimpleKeyInput
            label="Azure OpenAI Endpoint"
            placeholder="https://YOUR.openai.azure.com/openai/deployments/..."
            settingKey="AZURE_OPENAI_ENDPOINT"
          />
          <SimpleKeyInput
            label="xAI API Key"
            placeholder="xai-..."
            settingKey="XAI_API_KEY"
          />
          <SimpleKeyInput
            label="xAI Base URL"
            placeholder="https://api.x.ai/v1"
            settingKey="XAI_BASE_URL"
          />
          <SimpleKeyInput
            label="Media OpenAI-compatible API Key"
            placeholder="sk-..."
            settingKey="MEDIA_COMPAT_API_KEY"
          />
          <SimpleKeyInput
            label="Media OpenAI-compatible Base URL"
            placeholder="https://api.example.com/v1"
            settingKey="MEDIA_COMPAT_BASE_URL"
          />
          <SimpleKeyInput
            label="Ollama Base URL"
            placeholder="http://localhost:11434"
            settingKey="OLLAMA_BASE_URL"
          />
        </div>
      </section>

      {/* Workflow API Keys */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('settings:workflowKeys.title')}
        </h2>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('settings:workflowKeys.description')}
        </p>
        <div className="flex flex-col gap-4">
          <SimpleKeyInput label="Tavily API Key" placeholder="tvly-..." settingKey="TAVILY_API_KEY" />
          <SimpleKeyInput label="Slack Bot Token" placeholder="xoxb-..." settingKey="SLACK_BOT_TOKEN" />
          <SimpleKeyInput label="Discord Webhook URL" placeholder="https://discord.com/api/webhooks/..." settingKey="DISCORD_WEBHOOK_URL" />
          <SimpleKeyInput label="KIS App Key" placeholder="PSxxxxxx..." settingKey="KIS_APP_KEY" />
          <SimpleKeyInput label="KIS App Secret" placeholder="..." settingKey="KIS_APP_SECRET" />
        </div>
      </section>

      {/* Deploy */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Deploy
        </h2>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          Tokens used by Deploy nodes to publish static content to Vercel or Cloudflare Pages.
        </p>
        <div className="flex flex-col gap-4">
          <SimpleKeyInput label="Vercel API Token" placeholder="vercel_..." settingKey="VERCEL_API_TOKEN" />
          <SimpleKeyInput label="Cloudflare API Token" placeholder="..." settingKey="CLOUDFLARE_API_TOKEN" />
          <SimpleKeyInput label="Cloudflare Account ID" placeholder="hex account id" settingKey="CLOUDFLARE_ACCOUNT_ID" />
        </div>
      </section>

      <MediaStatusSection />

      {/* Appearance */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('settings:appearance.title')}
        </h2>
        <div className="flex flex-col gap-4">
          {/* Theme */}
          <div className="flex items-center justify-between">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('settings:appearance.theme')}</label>
            <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
              {(['dark', 'light', 'system'] as const).map((themeOption) => (
                <button
                  key={themeOption}
                  onClick={() => setTheme(themeOption as ThemeMode)}
                  className="rounded-md px-3 py-1 text-xs transition-colors"
                  style={{
                    backgroundColor: theme === themeOption ? 'var(--border-secondary)' : undefined,
                    color: theme === themeOption ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {t(`settings:appearance.${themeOption}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="flex items-center justify-between">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('settings:appearance.language')}
            </label>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={{
                borderColor: 'var(--border-secondary)',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </div>

          {/* Canvas overlay (v0.9 M1) */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
                htmlFor="canvas-overlay-toggle"
              >
                {t('settings:appearance.canvasOverlay')}
              </label>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('settings:appearance.canvasOverlayHint')}
              </p>
            </div>
            <button
              id="canvas-overlay-toggle"
              type="button"
              role="switch"
              aria-checked={canvasOverlay}
              data-testid="settings-canvas-overlay"
              onClick={() => {
                const next = !canvasOverlay;
                writeCanvasOverlayPref(next);
                setCanvasOverlay(next);
              }}
              className="rounded-md px-3 py-1 text-xs transition-colors"
              style={{
                border: '1px solid var(--border-secondary)',
                backgroundColor: canvasOverlay
                  ? 'var(--border-secondary)'
                  : 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                minWidth: 52,
              }}
            >
              {canvasOverlay ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </section>

      {/* MCP Servers */}
      <McpServersSection />

      {/* NEOS as MCP server (expose to coding agents) */}
      <NeosMcpExposeSection />

      {/* CLI Agents */}
      <CliAgentsSection />

      {/* Default Model */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('settings:defaults.title')}
        </h2>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('settings:defaults.provider')}
            </label>
            <select
              value={defaultProvider}
              onChange={(e) => {
                setDefaultProvider(e.target.value);
                handleSaveDefault('defaults.provider', e.target.value);
              }}
              className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="google">Google AI</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('settings:defaults.model')}</label>
            <select
              value={defaultModel}
              onChange={(e) => {
                setDefaultModel(e.target.value);
                handleSaveDefault('defaults.model', e.target.value);
              }}
              className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
              <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-2.0-pro">Gemini 2.0 Pro</option>
            </select>
          </div>
        </div>
      </section>

      {/* Dev Tools */}
      <DevToolsSection />
    </div>
  );
}

// --- Media generation status (from /api/media/config) ---

function MediaStatusSection() {
  const { client, status } = useEngine();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [imageModels, setImageModels] = useState<string[]>([]);
  const [audioModels, setAudioModels] = useState<string[]>([]);
  const [videoModels, setVideoModels] = useState<string[]>([]);
  const [stubsAllowed, setStubsAllowed] = useState(false);
  const [providers, setProviders] = useState<
    Array<{ id: string; label: string; configured: boolean; isStub?: boolean }>
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || status !== 'connected') {
      setConfigured(null);
      setBaseUrl(null);
      setSurfaces([]);
      setImageModels([]);
      setAudioModels([]);
      setVideoModels([]);
      setStubsAllowed(false);
      setProviders([]);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void client
      .getMediaConfig()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setConfigured(null);
          setBaseUrl(null);
          setSurfaces([]);
          setImageModels([]);
          setAudioModels([]);
          setVideoModels([]);
          setStubsAllowed(false);
          setProviders([]);
          setLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load media config',
          );
          return;
        }
        setConfigured(res.data.openaiConfigured);
        const rawUrl = res.data.openaiBaseUrl;
        setBaseUrl(
          typeof rawUrl === 'string'
            ? scrubDisplayText(rawUrl, { collapseLines: true, maxChars: 200 }) || null
            : null,
        );
        setSurfaces(
          (res.data.surfaces ?? [])
            .map((s) => scrubDisplayText(s, { collapseLines: true, maxChars: 40 }))
            .filter(Boolean) as string[],
        );
        setImageModels(
          (res.data.imageModels ?? [])
            .map((s) => scrubDisplayText(s, { collapseLines: true, maxChars: 80 }))
            .filter(Boolean) as string[],
        );
        setAudioModels(
          (res.data.audioModels ?? [])
            .map((s) => scrubDisplayText(s, { collapseLines: true, maxChars: 80 }))
            .filter(Boolean) as string[],
        );
        setVideoModels(
          (res.data.videoModels ?? [])
            .map((s) => scrubDisplayText(s, { collapseLines: true, maxChars: 80 }))
            .filter(Boolean) as string[],
        );
        setStubsAllowed(!!res.data.stubsAllowed);
        setProviders(
          (res.data.providers ?? []).map((p) => ({
            id: scrubDisplayText(p.id, { collapseLines: true, maxChars: 40 }) || p.id,
            label: scrubDisplayText(p.label, { collapseLines: true, maxChars: 80 }) || p.id,
            configured: !!p.configured,
            isStub: !!p.isStub,
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setConfigured(null);
        setBaseUrl(null);
        setSurfaces([]);
        setImageModels([]);
        setAudioModels([]);
        setVideoModels([]);
        setStubsAllowed(false);
        setProviders([]);
        const msg = err instanceof Error ? err.message : 'Failed to load media config';
        setLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || 'Failed to load media config',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const baseUrlSafe = baseUrl
    ? scrubDisplayText(baseUrl, { collapseLines: true, maxChars: 200 })
    : '';

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Media generation
      </h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        Multi-provider catalog (image / audio / video). Keys under API Keys &amp; media settings below.
        Stubs default off (NEOS_MEDIA_ALLOW_STUBS).
      </p>
      {loadError && (
        <p className="mb-3 text-xs text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt style={{ color: 'var(--text-muted)' }}>OpenAI key</dt>
        <dd style={{ color: configured ? '#34d399' : 'var(--text-primary)' }}>
          {configured == null ? '—' : configured ? 'Configured' : 'Not set'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Base URL</dt>
        <dd className="truncate" style={{ color: 'var(--text-primary)' }} title={baseUrlSafe || undefined}>
          {baseUrlSafe || 'default'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Surfaces</dt>
        <dd style={{ color: 'var(--text-primary)' }}>
          {surfaces.length > 0 ? surfaces.join(', ') : '—'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Models</dt>
        <dd style={{ color: 'var(--text-primary)' }}>
          {[...imageModels, ...audioModels, ...videoModels].join(', ') || '—'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Stubs</dt>
        <dd style={{ color: stubsAllowed ? '#fbbf24' : 'var(--text-primary)' }}>
          {stubsAllowed ? 'Allowed' : 'Disabled (default)'}
        </dd>
      </dl>
      {providers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="media-provider-list">
          {providers.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>
                {p.label}
                {p.isStub ? ' (stub)' : ''}
              </span>
              <span style={{ color: p.configured ? '#34d399' : 'var(--text-muted)' }}>
                {p.configured ? 'ready' : 'not configured'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Collab bus / presence registry (GET /api/collab/status) ---

function CollabStatusSection() {
  const { client, status } = useEngine();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    bus?: string;
    nodeId?: string;
    ready?: boolean;
    detail?: string | null;
    presence?: { kind?: string; ready?: boolean; detail?: string | null };
  } | null>(null);

  const load = useCallback(async () => {
    if (!client || status !== 'connected') {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.getCollabStatus();
      if (!res.ok) {
        setData(null);
        setError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || 'Failed to load collab status',
        );
        return;
      }
      setData(res.data ?? null);
    } catch (err) {
      setData(null);
      const msg = err instanceof Error ? err.message : 'Failed to load collab status';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setLoading(false);
    }
  }, [client, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status !== 'connected') {
    return (
      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        data-testid="collab-status-section"
      >
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Collab status
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Connect to the engine to inspect bus and presence registry.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      data-testid="collab-status-section"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Collab status
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Multi-replica bus and presence registry (no secrets).
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50"
          style={{
            borderColor: 'var(--border-secondary)',
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--bg-tertiary)',
          }}
          data-testid="collab-status-refresh"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p className="mb-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs"
          data-testid="collab-status-body"
        >
          <dt style={{ color: 'var(--text-muted)' }}>bus</dt>
          <dd style={{ color: 'var(--text-primary)' }} data-testid="collab-status-bus">
            {data.bus ?? '—'}
            {typeof data.ready === 'boolean' ? (data.ready ? ' · ready' : ' · not ready') : ''}
          </dd>
          <dt style={{ color: 'var(--text-muted)' }}>nodeId</dt>
          <dd
            className="truncate"
            style={{ color: 'var(--text-primary)' }}
            data-testid="collab-status-node"
            title={data.nodeId}
          >
            {data.nodeId ?? '—'}
          </dd>
          {data.detail ? (
            <>
              <dt style={{ color: 'var(--text-muted)' }}>detail</dt>
              <dd style={{ color: 'var(--text-secondary)' }}>{data.detail}</dd>
            </>
          ) : null}
          <dt style={{ color: 'var(--text-muted)' }}>presence</dt>
          <dd style={{ color: 'var(--text-primary)' }} data-testid="collab-status-presence">
            {data.presence?.kind ?? '—'}
            {typeof data.presence?.ready === 'boolean'
              ? data.presence.ready
                ? ' · ready'
                : ' · not ready'
              : ''}
          </dd>
          {data.presence?.detail ? (
            <>
              <dt style={{ color: 'var(--text-muted)' }}>p.detail</dt>
              <dd style={{ color: 'var(--text-secondary)' }}>{data.presence.detail}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        !error && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {loading ? 'Loading…' : 'No status loaded.'}
          </p>
        )
      )}
    </section>
  );
}

// --- Provider / URL reachability (POST /api/connection-test) ---

type ConnectionProbeTarget = 'openai' | 'anthropic' | 'ollama' | 'cli-agents' | 'url';

function ConnectionProbeSection() {
  const { client, status } = useEngine();
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [results, setResults] = useState<
    Record<string, { reachable?: boolean; blocked?: boolean; message?: string; status?: number }>
  >({});
  const [error, setError] = useState<string | null>(null);

  const runProbe = async (target: ConnectionProbeTarget) => {
    if (!client || busyTarget) return;
    if (target === 'url') {
      if (/[\0\r\n]/.test(customUrl) || !customUrl.trim()) {
        setError('Enter a valid http(s) URL to probe');
        return;
      }
    }
    setBusyTarget(target);
    setError(null);
    try {
      const res = await client.connectionTest(
        target === 'url' ? { target: 'url', url: customUrl.trim() } : { target },
      );
      if (!res.ok) {
        setError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || 'Connection test failed',
        );
        return;
      }
      const key = target === 'url' ? `url:${customUrl.trim().slice(0, 80)}` : target;
      setResults((prev) => ({
        ...prev,
        [key]: {
          reachable: res.data?.reachable,
          blocked: res.data?.blocked,
          message: res.data?.message,
          status: res.data?.status,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setBusyTarget(null);
    }
  };

  if (status !== 'connected') {
    return (
      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        data-testid="connection-probe-section"
      >
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Connection probes
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Connect to the engine to probe provider reachability (no secrets returned).
        </p>
      </section>
    );
  }

  const targets: Array<{ id: ConnectionProbeTarget; label: string }> = [
    { id: 'ollama', label: 'Ollama' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'cli-agents', label: 'CLI agents catalog' },
  ];

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      data-testid="connection-probe-section"
    >
      <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Connection probes
      </h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        Reachability checks via the daemon (SSRF-safe). Auth failures often still mean the endpoint is up.
      </p>
      {error && (
        <p className="mb-2 text-xs text-red-400" role="alert" data-testid="connection-probe-error">
          {scrubDisplayText(error, { collapseLines: true, maxChars: 300 }) || error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`connection-probe-${t.id}`}
            disabled={!!busyTarget}
            onClick={() => void runProbe(t.id)}
            className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            {busyTarget === t.id ? 'Probing…' : `Test ${t.label}`}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Custom URL
          <input
            className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
            }}
            data-testid="connection-probe-url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://…"
            disabled={!!busyTarget}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          data-testid="connection-probe-url-submit"
          disabled={!!busyTarget || !customUrl.trim()}
          onClick={() => void runProbe('url')}
          className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
        >
          {busyTarget === 'url' ? 'Probing…' : 'Test URL'}
        </button>
      </div>
      {Object.keys(results).length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="connection-probe-results">
          {Object.entries(results).map(([key, r]) => {
            const msg =
              scrubDisplayText(r.message, { collapseLines: true, maxChars: 200 }) || '';
            const tone = r.blocked
              ? '#fbbf24'
              : r.reachable
                ? '#34d399'
                : '#f87171';
            return (
              <li key={key} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {scrubDisplayText(key, { collapseLines: true, maxChars: 60 }) || key}
                </span>
                <span style={{ color: tone }}>
                  {r.blocked ? 'blocked' : r.reachable ? 'reachable' : 'unreachable'}
                  {typeof r.status === 'number' ? ` (HTTP ${r.status})` : ''}
                </span>
                {msg ? (
                  <span style={{ color: 'var(--text-muted)' }}>— {msg}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --- Engine status (version / uptime from /api/health) ---

function EngineStatusSection() {
  const { client, status, mode, serverUrl } = useEngine();
  const [version, setVersion] = useState<string | null>(null);
  const [uptimeSec, setUptimeSec] = useState<number | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || status !== 'connected') {
      setVersion(null);
      setUptimeSec(null);
      setHealthError(null);
      return;
    }
    let cancelled = false;
    setHealthError(null);
    void client
      .health()
      .then((h) => {
        if (cancelled) return;
        if (h.status !== 'ok') {
          setVersion(null);
          setUptimeSec(null);
          setHealthError('Health check failed');
          return;
        }
        setVersion(h.version ?? null);
        setUptimeSec(typeof h.uptime === 'number' ? h.uptime : null);
        setHealthError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setVersion(null);
          setUptimeSec(null);
          const msg = err instanceof Error ? err.message : 'Health check failed';
          setHealthError(
            scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
            || 'Health check failed',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  const uptimeLabel = formatEngineUptime(uptimeSec);
  const statusLabel =
    status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected';
  const versionSafe = version
    ? scrubDisplayText(version, { collapseLines: true, maxChars: 40 })
    : '';
  const urlSafe = serverUrl
    ? scrubDisplayText(serverUrl, { collapseLines: true, maxChars: 200 })
    : '';
  const healthErrorSafe = healthError
    ? scrubDisplayText(healthError, { collapseLines: true, maxChars: 300 }) || healthError
    : '';

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        Engine
      </h2>
      {healthErrorSafe ? (
        <p className="mb-3 text-xs text-red-400">{healthErrorSafe}</p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt style={{ color: 'var(--text-muted)' }}>Status</dt>
        <dd style={{ color: 'var(--text-primary)' }}>{statusLabel}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>Mode</dt>
        <dd style={{ color: 'var(--text-primary)' }}>
          {mode === 'host' ? 'Local' : mode === 'client' ? 'Remote' : '—'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Version</dt>
        <dd style={{ color: 'var(--text-primary)' }}>
          {versionSafe ? `v${versionSafe}` : '—'}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Uptime</dt>
        <dd style={{ color: 'var(--text-primary)' }}>{uptimeLabel || '—'}</dd>
        {urlSafe ? (
          <>
            <dt style={{ color: 'var(--text-muted)' }}>URL</dt>
            <dd
              className="truncate"
              style={{ color: 'var(--text-primary)' }}
              title={urlSafe}
            >
              {urlSafe}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

// --- API Key Input with Save/Verify ---

type VerifyStatus = 'idle' | 'verifying' | 'valid' | 'invalid';
type SaveStatus = 'idle' | 'saving' | 'saved';

function ApiKeyInput({
  label,
  placeholder,
  provider,
  settingKey,
}: {
  label: string;
  placeholder: string;
  provider: string;
  settingKey: string;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const { client } = useEngine();
  const [value, setValue] = useState('');
  const [masked, setMasked] = useState(true);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Load existing key from server on mount
  const loadSavedKey = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.getSetting(settingKey);
      if (res.ok && res.data?.value) {
        setHasSavedKey(true);
        // Don't show the actual key, just indicate it's saved
        setValue('');
      }
    } catch {
      // Key not saved yet
    }
  }, [client, settingKey]);

  useEffect(() => {
    loadSavedKey();
  }, [loadSavedKey]);

  const handleVerify = async () => {
    if (!client) return;
    // Control-char secrets rejected before trim (align with settings verify-key)
    if (/[\0\r\n]/.test(value)) {
      setVerifyStatus('invalid');
      setTimeout(() => setVerifyStatus('idle'), 3000);
      return;
    }
    const next = value.trim();
    if (!next) return;
    setVerifyStatus('verifying');
    try {
      const res = await client.verifyApiKey(provider, next);
      setVerifyStatus(res.ok && res.data?.valid ? 'valid' : 'invalid');
    } catch {
      setVerifyStatus('invalid');
    }
    // Reset status after 3s
    setTimeout(() => setVerifyStatus('idle'), 3000);
  };

  const handleSave = async () => {
    if (!client) return;
    // Control-char secrets rejected before trim (align with settings PUT)
    if (/[\0\r\n]/.test(value)) {
      setSaveStatus('idle');
      window.alert('Key contains invalid control characters');
      return;
    }
    const next = value.trim();
    if (!next) return;
    setSaveStatus('saving');
    try {
      const res = await client.saveSetting(settingKey, next);
      if (!res.ok) {
        setSaveStatus('idle');
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Save failed',
        );
        return;
      }
      setSaveStatus('saved');
      setHasSavedKey(true);
      setValue('');
    } catch (err) {
      setSaveStatus('idle');
      const msg = err instanceof Error ? err.message : 'Save failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed',
      );
      return;
    }
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const verifyLabel =
    verifyStatus === 'verifying'
      ? '...'
      : verifyStatus === 'valid'
        ? t('settings:apiKeys.verified')
        : verifyStatus === 'invalid'
          ? t('settings:apiKeys.invalid')
          : t('common:action.verify');

  const saveLabel =
    saveStatus === 'saving' ? '...' : saveStatus === 'saved' ? 'Saved!' : t('common:action.save');

  return (
    <div>
      <label className="mb-1.5 block text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
        {hasSavedKey && (
          <span className="ml-2 text-xs text-emerald-500">({t('settings:apiKeys.verified')})</span>
        )}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={masked ? 'password' : 'text'}
            placeholder={hasSavedKey ? '••••••••••••••' : placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 pr-8 text-sm outline-none"
            style={{
              borderColor: 'var(--border-secondary)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={() => setMasked(!masked)}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          >
            {masked ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        </div>
        <button
          onClick={handleVerify}
          disabled={!value || verifyStatus === 'verifying'}
          className={`rounded-lg border px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
            verifyStatus === 'valid'
              ? 'border-emerald-700 bg-emerald-900/50 text-emerald-300'
              : verifyStatus === 'invalid'
                ? 'border-red-700 bg-red-900/50 text-red-300'
                : ''
          }`}
          style={
            verifyStatus === 'idle' || verifyStatus === 'verifying'
              ? { borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
              : undefined
          }
        >
          {verifyLabel}
        </button>
        <button
          onClick={handleSave}
          disabled={!value || saveStatus === 'saving'}
          className={`rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
            saveStatus === 'saved'
              ? 'bg-emerald-700 text-emerald-100'
              : ''
          }`}
          style={
            saveStatus !== 'saved'
              ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }
              : undefined
          }
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

// --- Simple Key Input (no verify button, for non-LLM API keys) ---

function SimpleKeyInput({
  label,
  placeholder,
  settingKey,
}: {
  label: string;
  placeholder: string;
  settingKey: string;
}) {
  const { client } = useEngine();
  const [value, setValue] = useState('');
  const [hasSaved, setHasSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [masked, setMasked] = useState(true);

  useEffect(() => {
    if (!client) return;
    client.getSetting(settingKey).then((res) => {
      if (res.ok && res.data?.value) setHasSaved(true);
    }).catch(() => {});
  }, [client, settingKey]);

  const handleSave = async () => {
    if (!client) return;
    // Control-char secrets/paths rejected before trim (align with settings PUT)
    if (/[\0\r\n]/.test(value)) {
      window.alert('Value contains invalid control characters');
      return;
    }
    const next = value.trim();
    if (!next) return;
    setSaving(true);
    try {
      const res = await client.saveSetting(settingKey, next);
      if (!res.ok) {
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Save failed',
        );
        return;
      }
      setHasSaved(true);
      setValue('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
        {hasSaved && <span className="ml-2 text-xs text-emerald-500">(saved)</span>}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={masked ? 'password' : 'text'}
            placeholder={hasSaved ? '••••••••••••••' : placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 pr-8 text-sm outline-none"
            style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => setMasked(!masked)}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          >
            {masked ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!value || saving}
          className="rounded-lg px-3 py-2 text-xs disabled:opacity-40"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          {saving ? '...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// --- MCP Servers Section ---

interface OAuthStatus {
  connected: boolean;
  expiresAt?: string;
  scope?: string;
}

interface OAuthModalState {
  serverId: string;
  serverName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
}

/**
 * Only allow http(s) OAuth authorization URLs for shell open.
 * Control-char, non-http(s), and overlong values are rejected.
 * Exported for unit tests.
 */
export function safeOAuthAuthUrl(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > 2_048) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return s;
  } catch {
    return '';
  }
}

function McpServersSection() {
  const { client } = useEngine();
  const [servers, setServers] = useState<McpServerData[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [formName, setFormName] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [oauthStatuses, setOauthStatuses] = useState<Record<string, OAuthStatus>>({});
  const [oauthModal, setOauthModal] = useState<OAuthModalState | null>(null);
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [mcpLoadError, setMcpLoadError] = useState<string | null>(null);
  const [presets, setPresets] = useState<
    Array<{ id: string; name: string; domain?: string; description?: string }>
  >([]);
  // TradingView MCP preset
  const [tvInstallPath, setTvInstallPath] = useState('');
  const [tvAdding, setTvAdding] = useState(false);
  const [tvCdpStatus, setTvCdpStatus] = useState<string | null>(null);
  const [tvCdpChecking, setTvCdpChecking] = useState(false);
  const [showTvHelp, setShowTvHelp] = useState(false);

  const loadServers = useCallback(async () => {
    if (!client) return;
    setMcpLoadError(null);
    try {
      const res = await client.listMcpServers();
      if (res.ok && res.data) {
        setServers(res.data);
        // OAuth status is best-effort per server — never wipe the server list on status throw
        const statusMap: Record<string, OAuthStatus> = {};
        await Promise.all(
          res.data.map(async (s) => {
            try {
              // Skip control-char / blank / overlong server ids (status probe hygiene)
              const sid = safeEntityId(s.id);
              if (!sid) return;
              const st = await client.getMcpOAuthStatus(sid);
              if (st.ok && st.data) statusMap[sid] = st.data;
            } catch {
              // omit badge when status probe fails
            }
          }),
        );
        setOauthStatuses(statusMap);
      } else {
        setServers([]);
        setOauthStatuses({});
        setMcpLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load MCP servers',
        );
      }
    } catch (err) {
      setServers([]);
      setOauthStatuses({});
      const msg = err instanceof Error ? err.message : 'Failed to load MCP servers';
      setMcpLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
        || 'Failed to load MCP servers',
      );
    }
  }, [client]);

  const loadPresets = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.listMcpPresets();
      if (res.ok && Array.isArray(res.data)) {
        setPresets(
          res.data
            .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
            .map((p) => ({
              id: p.id,
              name: p.name,
              domain: typeof p.domain === 'string' ? p.domain : undefined,
              description: typeof p.description === 'string' ? p.description : undefined,
            })),
        );
      } else {
        setPresets([]);
      }
    } catch {
      setPresets([]);
    }
  }, [client]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const tradingViewConnected = servers.some(
    (s) =>
      s.enabled
      && typeof s.name === 'string'
      && s.name.toLowerCase().includes('tradingview'),
  );

  const handleAddTradingView = async () => {
    if (!client) return;
    if (/[\0\r\n]/.test(tvInstallPath)) {
      window.alert('Install path contains invalid control characters');
      return;
    }
    const path = tvInstallPath.trim();
    if (!path) {
      window.alert('Enter the full path to the tradingview-mcp folder (contains package.json and src/).');
      return;
    }
    setTvAdding(true);
    try {
      const res = await client.createMcpServerFromPreset({
        presetId: 'tradingview',
        installPath: path,
        name: 'TradingView',
      });
      if (res.ok) {
        setTvInstallPath('');
        await loadServers();
      } else {
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 400,
          }) || 'Failed to add TradingView MCP',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add TradingView MCP';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 400 }) || 'Failed to add TradingView MCP',
      );
    } finally {
      setTvAdding(false);
    }
  };

  const handleCheckTvCdp = async () => {
    if (!client) return;
    setTvCdpChecking(true);
    setTvCdpStatus(null);
    try {
      const res = await client.checkTradingViewCdp(9222);
      if (res.ok && res.data) {
        if (res.data.cdpConnected) {
          const browser = scrubDisplayText(res.data.browser, { collapseLines: true, maxChars: 80 });
          const targets =
            typeof res.data.targetCount === 'number' ? ` · ${res.data.targetCount} targets` : '';
          setTvCdpStatus(
            `Connected on port ${res.data.port}${browser ? ` · ${browser}` : ''}${targets}`,
          );
        } else {
          setTvCdpStatus(
            scrubDisplayText(res.data.error, { collapseLines: true, maxChars: 300 })
            || 'CDP not reachable — launch TradingView with --remote-debugging-port=9222',
          );
        }
      } else {
        setTvCdpStatus(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'CDP health check failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'CDP health check failed';
      setTvCdpStatus(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'CDP health check failed',
      );
    } finally {
      setTvCdpChecking(false);
    }
  };

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
    setFormName('');
    setFormCommand('');
    setFormArgs('');
    setFormUrl('');
    setTransport('stdio');
  }, []);

  // Escape closes MCP OAuth connect modal or the add-server form (and clears draft fields)
  useEffect(() => {
    if (!oauthModal && !showAddForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (oauthModal && !oauthConnecting) {
        e.preventDefault();
        setOauthModal(null);
        return;
      }
      if (showAddForm && !oauthModal) {
        e.preventDefault();
        closeAddForm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [oauthModal, oauthConnecting, showAddForm, closeAddForm]);

  const handleAdd = async () => {
    if (!client) return;
    // Control-char name/command/url rejected before trim (align with MCP create route)
    if (/[\0\r\n]/.test(formName)) {
      window.alert('Name contains invalid control characters');
      return;
    }
    if (transport === 'stdio' && formCommand && /[\0\r\n]/.test(formCommand)) {
      window.alert('Command contains invalid control characters');
      return;
    }
    if (transport === 'http' && formUrl && /[\0\r\n]/.test(formUrl)) {
      window.alert('URL contains invalid control characters');
      return;
    }
    if (!formName.trim()) return;
    setAdding(true);
    try {
      // Drop control-char args tokens before trim
      const args =
        transport === 'stdio' && formArgs
          ? formArgs
              .split(/\s+/)
              .filter((a) => a.length > 0 && !/[\0\r\n]/.test(a))
          : undefined;
      const res = await client.createMcpServer({
        name: formName.trim(),
        transport,
        command: transport === 'stdio' ? (formCommand.trim() || undefined) : undefined,
        args: transport === 'stdio' ? (args && args.length > 0 ? args : undefined) : undefined,
        url: transport === 'http' ? (formUrl.trim() || undefined) : undefined,
      });
      if (res.ok) {
        closeAddForm();
        await loadServers();
      } else {
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to add MCP server',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add MCP server';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to add MCP server',
      );
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!client) return;
    // Control-char / blank / overlong ids never sent to toggle API
    const safeId = safeEntityId(id);
    if (!safeId) {
      window.alert('MCP server id contains invalid control characters');
      return;
    }
    try {
      const res = await client.toggleMcpServer(safeId, enabled);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Update failed';
        window.alert(err);
        return;
      }
      setServers((prev) =>
        prev.map((s) => (s.id === id || s.id === safeId ? { ...s, enabled } : s)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Update failed',
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    // Control-char / blank / overlong ids never sent to delete API
    const safeId = safeEntityId(id);
    if (!safeId) {
      window.alert('MCP server id contains invalid control characters');
      return;
    }
    try {
      const res = await client.deleteMcpServer(safeId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed';
        window.alert(err);
        return;
      }
      setServers((prev) => prev.filter((s) => s.id !== id && s.id !== safeId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed',
      );
    }
  };

  const handleOAuthConnect = async () => {
    if (!client || !oauthModal) return;
    // Control-char / blank / overlong server ids never sent to OAuth start
    const oauthServerId = safeEntityId(oauthModal.serverId);
    if (!oauthServerId) {
      window.alert('MCP server id contains invalid control characters');
      return;
    }
    // Control-char OAuth fields rejected before trim (endpoint/token injection defense)
    const { authorizationEndpoint, tokenEndpoint, clientId, scope } = oauthModal;
    if (
      /[\0\r\n]/.test(authorizationEndpoint)
      || /[\0\r\n]/.test(tokenEndpoint)
      || /[\0\r\n]/.test(clientId)
      || (scope && /[\0\r\n]/.test(scope))
    ) {
      window.alert('OAuth fields contain invalid control characters');
      return;
    }
    const authEp = authorizationEndpoint.trim();
    const tokenEp = tokenEndpoint.trim();
    const cid = clientId.trim();
    if (!authEp || !tokenEp || !cid) return;
    setOauthConnecting(true);
    try {
      // Must match server mount (`/api/mcp-servers`) and actual engine base URL/port.
      // Browser redirect has no Bearer — server exempts this path (PKCE state auth).
      const base =
        typeof client.url === 'string' && client.url.trim()
          ? client.url.trim().replace(/\/+$/, '')
          : 'http://127.0.0.1:3000';
      const redirectUri = `${base}/api/mcp-servers/oauth/callback`;
      const res = await client.startMcpOAuth({
        serverId: oauthServerId,
        authorizationEndpoint: authEp,
        tokenEndpoint: tokenEp,
        clientId: cid,
        redirectUri,
        scope: scope?.trim() || undefined,
      });
      if (res.ok && res.data?.authUrl) {
        // Gate authUrl before shell open (javascript:/control-char injection defense)
        const authUrl = safeOAuthAuthUrl(res.data.authUrl);
        if (!authUrl) {
          window.alert('OAuth start failed: invalid authorization URL');
          return;
        }
        // Open in system browser via Tauri
        try {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(authUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to open browser';
          window.alert(
            scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to open browser',
          );
          return;
        }
        const serverId = oauthServerId;
        setOauthModal(null);
        // Poll for token after 3s — best-effort; never surface unhandled rejection
        setTimeout(() => {
          void (async () => {
            try {
              const st = await client.getMcpOAuthStatus(serverId);
              if (st.ok && st.data) {
                setOauthStatuses((prev) => ({ ...prev, [serverId]: st.data! }));
              }
            } catch {
              // omit badge refresh when status probe fails
            }
          })();
        }, 3000);
      } else {
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'OAuth start failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OAuth start failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'OAuth start failed',
      );
    } finally {
      setOauthConnecting(false);
    }
  };

  const handleOAuthRevoke = async (serverId: string) => {
    if (!client) return;
    // Control-char / blank / overlong ids never sent to revoke API
    const safeId = safeEntityId(serverId);
    if (!safeId) {
      window.alert('MCP server id contains invalid control characters');
      return;
    }
    try {
      const res = await client.revokeMcpOAuth(safeId);
      if (!res.ok) {
        window.alert(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Revoke failed',
        );
        return;
      }
      setOauthStatuses((prev) => ({ ...prev, [safeId]: { connected: false } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Revoke failed',
      );
    }
  };

  return (
    <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>MCP Servers</h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="rounded-lg border px-3 py-1.5 text-xs transition-colors"
          style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          + Add
        </button>
      </div>

      {presets.length > 0 && (
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }} data-testid="mcp-presets-list">
          Built-in presets:{' '}
          {presets
            .map((p) => {
              const name = scrubDisplayText(p.name, { collapseLines: true, maxChars: 40 }) || p.id;
              const domain = p.domain
                ? scrubDisplayText(p.domain, { collapseLines: true, maxChars: 24 })
                : '';
              return domain ? `${name} (${domain})` : name;
            })
            .join(' · ')}
        </p>
      )}

      {/* TradingView finance preset */}
      <div
        className="mb-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                TradingView MCP
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}
              >
                finance
              </span>
              {tradingViewConnected && (
                <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: '#065f4620', color: '#059669' }}>
                  ● Connected
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Bridge NEOS agents to your local TradingView Desktop charts (CDP port 9222).
              Clone{' '}
              <span className="font-mono">tradesdontlie/tradingview-mcp</span>, run npm install,
              launch TV with debug port, then paste the package path below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowTvHelp((v) => !v)}
            className="shrink-0 rounded-lg border px-2 py-1 text-[10px]"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {showTvHelp ? 'Hide setup' : 'Setup guide'}
          </button>
        </div>

        {showTvHelp && (
          <ol
            className="mb-3 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            <li>
              Install Node.js LTS and TradingView <strong>Desktop</strong> (browser-only will not work; paid plan required).
            </li>
            <li>
              Download ZIP from github.com/tradesdontlie/tradingview-mcp → extract. Use the folder that
              directly contains <span className="font-mono">package.json</span> and <span className="font-mono">src/</span>
              (watch for nested folder-in-folder).
            </li>
            <li>
              In that folder run <span className="font-mono">npm install</span>. Ignore audit warnings; do not run npm audit fix.
            </li>
            <li>
              Fully quit TradingView, then launch with debug port:
              <br />
              <span className="font-mono text-[10px]">
                Mac: open -a TradingView --args --remote-debugging-port=9222
              </span>
              <br />
              <span className="font-mono text-[10px]">
                Windows: &quot;%LOCALAPPDATA%\TradingView\TradingView.exe&quot; --remote-debugging-port=9222
              </span>
            </li>
            <li>Log in and open a real chart tab (not the welcome screen).</li>
            <li>Paste the package path below → Add → open a new Session chat and ask for tv_health_check.</li>
          </ol>
        )}

        {!tradingViewConnected && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              placeholder="Full path to tradingview-mcp (…/tradingview-mcp or …/tradingview-mcp-main)"
              value={tvInstallPath}
              onChange={(e) => setTvInstallPath(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none font-mono"
              style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            />
            <button
              type="button"
              onClick={handleAddTradingView}
              disabled={tvAdding || !tvInstallPath.trim()}
              className="shrink-0 rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#059669', color: 'white' }}
            >
              {tvAdding ? 'Adding…' : 'Add TradingView'}
            </button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCheckTvCdp}
            disabled={tvCdpChecking}
            className="rounded-lg border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {tvCdpChecking ? 'Checking CDP…' : 'Test CDP :9222'}
          </button>
          {tvCdpStatus && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {scrubDisplayText(tvCdpStatus, { collapseLines: true, maxChars: 280 }) || tvCdpStatus}
            </span>
          )}
        </div>
      </div>

      {/* OAuth Connect Modal */}
      {oauthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border p-5 shadow-xl" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Connect: {scrubDisplayText(oauthModal.serverName, { collapseLines: true, maxChars: 200 }) || 'MCP'}
            </h3>
            <div className="flex flex-col gap-2">
              <input
                placeholder="Authorization Endpoint"
                value={oauthModal.authorizationEndpoint}
                onChange={(e) => setOauthModal((m) => m ? { ...m, authorizationEndpoint: e.target.value } : m)}
                className="rounded-lg border px-3 py-2 text-xs outline-none"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
              <input
                placeholder="Token Endpoint"
                value={oauthModal.tokenEndpoint}
                onChange={(e) => setOauthModal((m) => m ? { ...m, tokenEndpoint: e.target.value } : m)}
                className="rounded-lg border px-3 py-2 text-xs outline-none"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
              <input
                placeholder="Client ID"
                value={oauthModal.clientId}
                onChange={(e) => setOauthModal((m) => m ? { ...m, clientId: e.target.value } : m)}
                className="rounded-lg border px-3 py-2 text-xs outline-none"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
              <input
                placeholder="Scope (optional)"
                value={oauthModal.scope}
                onChange={(e) => setOauthModal((m) => m ? { ...m, scope: e.target.value } : m)}
                className="rounded-lg border px-3 py-2 text-xs outline-none"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
            </div>
            <p className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              A browser window will open to complete authorization.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setOauthModal(null)}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleOAuthConnect}
                disabled={oauthConnecting || !oauthModal.authorizationEndpoint || !oauthModal.tokenEndpoint || !oauthModal.clientId}
                className="rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                style={{ backgroundColor: '#059669', color: 'white' }}
              >
                {oauthConnecting ? 'Opening...' : 'Open Browser'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="mb-4 rounded-lg border p-4" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex flex-col gap-3">
            <input
              placeholder="Server name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            />
            <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)' }}>
              {(['stdio', 'http'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTransport(t)}
                  className="flex-1 rounded-md px-3 py-1 text-xs transition-colors"
                  style={{
                    backgroundColor: transport === t ? 'var(--border-secondary)' : undefined,
                    color: transport === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {transport === 'stdio' ? (
              <>
                <input
                  placeholder="Command (e.g. npx)"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                />
                <input
                  placeholder="Args (space-separated, e.g. -y @server/pkg /path)"
                  value={formArgs}
                  onChange={(e) => setFormArgs(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                />
              </>
            ) : (
              <input
                placeholder="Server URL (e.g. http://localhost:3000/sse)"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={closeAddForm}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!formName || adding || (transport === 'stdio' && !formCommand) || (transport === 'http' && !formUrl)}
                className="rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
              >
                {adding ? 'Adding...' : 'Add Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mcpLoadError ? (
        <p className="text-xs text-red-400">
          {scrubDisplayText(mcpLoadError, { collapseLines: true, maxChars: 300 }) || mcpLoadError}
        </p>
      ) : servers.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No MCP servers configured. Add a server to extend the agent with external tools.
        </p>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const oauthSt = oauthStatuses[server.id];
            return (
              <div
                key={server.id}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {scrubDisplayText(server.name, { collapseLines: true, maxChars: 200 }) || 'MCP'}
                      </span>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {scrubDisplayText(server.transport, { collapseLines: true, maxChars: 20 }) || '—'}
                      </span>
                      {/* OAuth status badge */}
                      {oauthSt && (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: oauthSt.connected ? '#065f4620' : 'var(--bg-tertiary)',
                            color: oauthSt.connected ? '#059669' : 'var(--text-muted)',
                          }}
                        >
                          {oauthSt.connected ? '● OAuth' : '○ OAuth'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {server.transport === 'stdio'
                        ? (() => {
                            const cmd =
                              typeof server.command === 'string' && !/[\0\r\n]/.test(server.command)
                                ? server.command.trim()
                                : '';
                            const args = (server.args ?? [])
                              .filter((a): a is string => typeof a === 'string' && !/[\0\r\n]/.test(a) && a.trim().length > 0)
                              .map((a) => a.trim())
                              .join(' ');
                            return scrubDisplayText([cmd, args].filter(Boolean).join(' '), {
                              collapseLines: true,
                              maxChars: 300,
                            }) || '—';
                          })()
                        : scrubDisplayText(server.url, { collapseLines: true, maxChars: 300 }) || '—'}
                    </p>
                  </div>
                  <div className="ml-2 flex items-center gap-2">
                    {/* OAuth connect/disconnect */}
                    {oauthSt?.connected ? (
                      <button
                        onClick={() => handleOAuthRevoke(server.id)}
                        className="rounded px-2 py-1 text-[10px] transition-colors"
                        style={{ color: '#ef4444', backgroundColor: '#ef444410' }}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          // Control-char / blank / overlong server ids never enter OAuth modal
                          const sid = safeEntityId(server.id);
                          if (!sid) {
                            window.alert('MCP server id contains invalid control characters');
                            return;
                          }
                          setOauthModal({
                            serverId: sid,
                            serverName: scrubDisplayText(server.name, { collapseLines: true, maxChars: 200 }) || 'MCP',
                            authorizationEndpoint: '',
                            tokenEndpoint: '',
                            clientId: '',
                            scope: '',
                          });
                        }}
                        className="rounded px-2 py-1 text-[10px] transition-colors"
                        style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
                      >
                        OAuth
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(server.id, !server.enabled)}
                      className="relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full transition-colors"
                      style={{ backgroundColor: server.enabled ? '#059669' : 'var(--bg-tertiary)' }}
                    >
                      <span
                        className="inline-block h-4 w-4 transform rounded-full shadow transition-transform"
                        style={{
                          backgroundColor: 'white',
                          transform: server.enabled ? 'translateX(16px)' : 'translateX(0)',
                        }}
                      />
                    </button>
                    <button
                      onClick={() => handleDelete(server.id)}
                      className="rounded p-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// --- NEOS MCP expose (install snippets + Codex one-click) ---

function NeosMcpExposeSection() {
  const { client } = useEngine();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<McpInstallInfo | null>(null);
  const [codexStatus, setCodexStatus] = useState<{
    available: boolean;
    installed: boolean;
    detail: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hideToken, setHideToken] = useState(true);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [infoRes, stRes] = await Promise.all([
        client.getMcpInstallInfo({ includeToken: !hideToken }),
        client.getCodexMcpInstallStatus(),
      ]);
      if (infoRes.ok && infoRes.data) {
        setInfo(infoRes.data as McpInstallInfo);
      } else {
        setInfo(null);
        setError(
          scrubDisplayText(infoRes.error, { collapseLines: true, maxChars: 300 })
            || 'Failed to load install info',
        );
      }
      if (stRes.ok && stRes.data) {
        setCodexStatus({
          available: Boolean(stRes.data.available),
          installed: Boolean(stRes.data.installed),
          detail:
            typeof stRes.data.detail === 'string'
              ? scrubDisplayText(stRes.data.detail, { collapseLines: true, maxChars: 200 })
              : null,
        });
      } else {
        setCodexStatus(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load MCP expose info';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [client, hideToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstallCodex = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.installCodexMcp();
      if (!res.ok) {
        setError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || 'codex mcp add failed',
        );
      }
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setBusy(false);
    }
  };

  const handleUninstallCodex = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.uninstallCodexMcp();
      if (!res.ok) {
        setError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || 'codex mcp remove failed',
        );
      }
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Uninstall failed';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <McpInstallPanel
      info={info}
      codexStatus={codexStatus}
      loading={loading}
      busy={busy}
      error={error}
      hideToken={hideToken}
      onHideTokenChange={setHideToken}
      onRefresh={() => void load()}
      onInstallCodex={() => void handleInstallCodex()}
      onUninstallCodex={() => void handleUninstallCodex()}
      showCodexActions
      description="Expose Design Project files and live artifacts to external coding agents via neos mcp serve (stdio). Install snippets for Claude Desktop / Cursor and optional Codex one-click."
    />
  );
}

// --- CLI Agents Section ---

interface CliAgentInfo {
  id: string;
  name: string;
  path: string;
  version?: string;
}

function CliAgentsSection() {
  const { client } = useEngine();
  const [agents, setAgents] = useState<CliAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.listCliAgents();
      if (res.ok && res.data) {
        setAgents(res.data);
      } else {
        setError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load CLI agents',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to server';
      setError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
        || 'Failed to connect to server',
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return (
    <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>CLI Agents</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            Detected coding-agent CLIs on this machine (registry: Claude, Codex, Gemini, OpenCode, Aider, …).
            Optional absolute paths override PATH lookup (plan Task 3).
          </p>
        </div>
        <button
          onClick={loadAgents}
          className="rounded-lg border px-3 py-1.5 text-xs transition-colors"
          style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Detecting CLI agents...</p>
      ) : error ? (
        <p className="text-xs text-red-400">
          {scrubDisplayText(error, { collapseLines: true, maxChars: 300 })
            || 'Failed to detect CLI agents'}
        </p>
      ) : agents.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No CLI agents detected. Install{' '}
          <code className="rounded bg-black/20 px-1">claude</code>,{' '}
          <code className="rounded bg-black/20 px-1">gemini</code>, or{' '}
          <code className="rounded bg-black/20 px-1">codex</code>, or set a manual path below.
        </p>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {scrubDisplayText(agent.name, { collapseLines: true, maxChars: 120 }) || 'CLI'}
                  </span>
                  <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    detected
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {scrubDisplayText(agent.path, { collapseLines: true, maxChars: 200 })}
                  {agent.version
                    ? ` · ${scrubDisplayText(agent.version, { collapseLines: true, maxChars: 40 })}`
                    : ''}
                </p>
              </div>
              <span className="rounded px-2 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {scrubDisplayText(agent.id, { collapseLines: true, maxChars: 40 }) || '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-primary)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Manual binary paths</p>
        <SimpleKeyInput label="Claude Code path" placeholder="/usr/local/bin/claude" settingKey="CLI_PATH_CLAUDE" />
        <SimpleKeyInput label="Gemini CLI path" placeholder="/usr/local/bin/gemini" settingKey="CLI_PATH_GEMINI" />
        <SimpleKeyInput label="Codex CLI path" placeholder="/usr/local/bin/codex" settingKey="CLI_PATH_CODEX" />
        <SimpleKeyInput label="OpenCode path" placeholder="/usr/local/bin/opencode" settingKey="CLI_PATH_OPENCODE" />
        <SimpleKeyInput label="Cursor Agent path" placeholder="/usr/local/bin/cursor-agent" settingKey="CLI_PATH_CURSOR" />
        <SimpleKeyInput label="Aider path" placeholder="/usr/local/bin/aider" settingKey="CLI_PATH_AIDER" />
        <SimpleKeyInput label="Copilot path" placeholder="/usr/local/bin/copilot" settingKey="CLI_PATH_COPILOT" />
        <SimpleKeyInput label="Qwen path" placeholder="/usr/local/bin/qwen" settingKey="CLI_PATH_QWEN" />
        <SimpleKeyInput label="Kimi path" placeholder="/usr/local/bin/kimi" settingKey="CLI_PATH_KIMI" />
        <SimpleKeyInput label="Grok path" placeholder="/usr/local/bin/grok" settingKey="CLI_PATH_GROK" />
        <SimpleKeyInput label="Continue (cn) path" placeholder="/usr/local/bin/cn" settingKey="CLI_PATH_CONTINUE" />
        <button
          type="button"
          onClick={loadAgents}
          className="rounded-lg border px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
        >
          Re-detect with overrides
        </button>
      </div>
    </section>
  );
}

// --- Dev Tools Section ---

function DevToolsSection() {
  const { client } = useEngine();
  const [token, setToken] = useState(() => sessionStorage.getItem('devAuthToken') ?? '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // Control-char tokens never stored (header injection defense)
    if (token && /[\0\r\n]/.test(token)) {
      window.alert('Token contains invalid control characters');
      return;
    }
    const next = token.trim();
    if (next) {
      sessionStorage.setItem('devAuthToken', next);
    } else {
      sessionStorage.removeItem('devAuthToken');
    }
    client?.setAuthToken(next || '');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
      <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Dev Tools</h2>
      <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        Override the auth token used to connect to the engine (stored in sessionStorage).
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder="Override Bearer token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--border-secondary)',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={handleSave}
          className="rounded-lg px-3 py-2 text-xs transition-colors"
          style={
            saved
              ? { backgroundColor: '#065f46', color: '#6ee7b7' }
              : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }
          }
        >
          {saved ? 'Saved!' : 'Apply'}
        </button>
      </div>
    </section>
  );
}
