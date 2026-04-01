import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import { useTheme } from '../hooks/useTheme.js';
import type { ThemeMode } from '../hooks/useTheme.js';
import type { McpServerData } from '../lib/engine.js';

export function Settings() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { client } = useEngine();
  const { theme, setTheme } = useTheme();

  // Default provider / model
  const [defaultProvider, setDefaultProvider] = useState('anthropic');
  const [defaultModel, setDefaultModel] = useState('claude-sonnet-4-5-20250929');

  // Load saved defaults from server
  useEffect(() => {
    if (!client) return;
    client.getSettings().then((res) => {
      if (res.ok && res.data) {
        if (res.data['defaults.provider']) setDefaultProvider(res.data['defaults.provider']);
        if (res.data['defaults.model']) setDefaultModel(res.data['defaults.model']);
      }
    });
  }, [client]);

  const handleSaveDefault = async (key: string, value: string) => {
    if (!client) return;
    await client.saveSetting(key, value);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('settings:title')}</h1>

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
        </div>
      </section>

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
        </div>
      </section>

      {/* MCP Servers */}
      <McpServersSection />

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
    </div>
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
    if (!client || !value) return;
    setVerifyStatus('verifying');
    try {
      const res = await client.verifyApiKey(provider, value);
      setVerifyStatus(res.ok && res.data?.valid ? 'valid' : 'invalid');
    } catch {
      setVerifyStatus('invalid');
    }
    // Reset status after 3s
    setTimeout(() => setVerifyStatus('idle'), 3000);
  };

  const handleSave = async () => {
    if (!client || !value) return;
    setSaveStatus('saving');
    try {
      await client.saveSetting(settingKey, value);
      setSaveStatus('saved');
      setHasSavedKey(true);
      setValue('');
    } catch {
      setSaveStatus('idle');
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

// --- MCP Servers Section ---

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

  const loadServers = useCallback(async () => {
    if (!client) return;
    const res = await client.listMcpServers();
    if (res.ok && res.data) setServers(res.data);
  }, [client]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleAdd = async () => {
    if (!client || !formName) return;
    setAdding(true);
    try {
      const args = formArgs.trim() ? formArgs.split(/\s+/) : undefined;
      const res = await client.createMcpServer({
        name: formName,
        transport,
        command: transport === 'stdio' ? formCommand : undefined,
        args: transport === 'stdio' ? args : undefined,
        url: transport === 'http' ? formUrl : undefined,
      });
      if (res.ok) {
        setFormName('');
        setFormCommand('');
        setFormArgs('');
        setFormUrl('');
        setShowAddForm(false);
        await loadServers();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!client) return;
    await client.toggleMcpServer(id, enabled);
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.deleteMcpServer(id);
    setServers((prev) => prev.filter((s) => s.id !== id));
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
                onClick={() => setShowAddForm(false)}
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

      {servers.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No MCP servers configured. Add a server to extend the agent with external tools.
        </p>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {server.name}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono"
                    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                  >
                    {server.transport}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {server.transport === 'stdio'
                    ? `${server.command} ${(server.args ?? []).join(' ')}`
                    : server.url}
                </p>
              </div>
              <div className="ml-2 flex items-center gap-2">
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
          ))}
        </div>
      )}
    </section>
  );
}
