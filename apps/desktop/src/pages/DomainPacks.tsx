/**
 * Domain Packs UI — list built-in + custom packs, install from path/zip, validate, enable/disable.
 * PLAN_FOR_V0_5_0 Task 15.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import { scrubDisplayText } from '../lib/format-duration.js';

type PackRow = {
  id: string;
  name: string;
  description?: string;
  workerCount?: number;
  blockCount?: number;
  isBuiltIn?: boolean;
  enabled?: boolean;
  version?: string;
  sourcePath?: string;
};

const ZIP_MAX_BYTES = 10 * 1024 * 1024;

/** Read text from a Blob/File across browsers and jsdom (File#text may be missing). */
async function readBlobText(blob: Blob): Promise<string> {
  const withText = blob as Blob & { text?: () => Promise<string> };
  if (typeof withText.text === 'function') {
    try {
      return await withText.text();
    } catch {
      // fall through
    }
  }
  if (typeof blob.arrayBuffer === 'function') {
    try {
      const buf = await blob.arrayBuffer();
      return new TextDecoder().decode(buf);
    } catch {
      // fall through
    }
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(blob);
  });
}

export function DomainPacks() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installPath, setInstallPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const validateInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.listDomainPacks();
      if (res.ok && res.data) {
        setPacks(res.data as PackRow[]);
      } else {
        setPacks([]);
        setError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load domain packs',
        );
      }
    } catch (err) {
      setPacks([]);
      const msg = err instanceof Error ? err.message : 'Failed to load domain packs';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstall = async () => {
    if (!client || busy) return;
    const path = installPath.trim();
    if (!path || /[\0\r\n]/.test(path)) {
      setMessage('Enter a local directory path containing pack.json');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await client.installDomainPackFromPath(path);
      if (res.ok) {
        setMessage('Installed pack successfully');
        setInstallPath('');
        await load();
      } else {
        setMessage(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Install failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      setMessage(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    } finally {
      setBusy(false);
    }
  };

  const handleInstallZip = async (file: File | null) => {
    if (!client || busy || !file) return;
    if (file.size <= 0) {
      setMessage('Empty zip file');
      return;
    }
    if (file.size > ZIP_MAX_BYTES) {
      setMessage('Zip too large (max 10 MiB)');
      return;
    }
    const nameOk = file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip');
    if (!nameOk && file.type && !file.type.includes('octet-stream')) {
      setMessage('Choose a .zip domain pack archive');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await client.installDomainPackFromZip(file);
      if (res.ok) {
        const id =
          res.data && typeof res.data.id === 'string'
            ? scrubDisplayText(res.data.id, { collapseLines: true, maxChars: 64 })
            : '';
        setMessage(id ? `Installed pack “${id}” from zip` : 'Installed pack from zip');
        await load();
      } else {
        setMessage(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Zip install failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Zip install failed';
      setMessage(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    } finally {
      setBusy(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  const handleValidateFile = async (file: File | null) => {
    if (!client || busy || !file) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await readBlobText(file);
      if (/\0/.test(text)) {
        setMessage('pack.json contains invalid null bytes');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        setMessage('pack.json is not valid JSON');
        return;
      }
      const res = await client.validateDomainPackManifest(parsed);
      if (res.ok && res.data) {
        const name =
          scrubDisplayText(res.data.name, { collapseLines: true, maxChars: 80 })
          || scrubDisplayText(res.data.id, { collapseLines: true, maxChars: 64 })
          || 'pack';
        const ver = res.data.version
          ? scrubDisplayText(String(res.data.version), { collapseLines: true, maxChars: 20 })
          : '';
        setMessage(
          `Valid: ${name}${ver ? ` v${ver}` : ''} · ${res.data.workerCount ?? 0} workers · ${res.data.blockCount ?? 0} blocks`,
        );
      } else {
        setMessage(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Validation failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation failed';
      setMessage(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    } finally {
      setBusy(false);
      if (validateInputRef.current) validateInputRef.current.value = '';
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!client || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await client.toggleDomainPack(id, enabled);
      if (!res.ok) {
        setMessage(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 200,
          }) || 'Toggle failed',
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!client || busy) return;
    const safeId = scrubDisplayText(id, { collapseLines: true, maxChars: 64 }) || 'pack';
    if (!window.confirm(`Uninstall domain pack “${safeId}”?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await client.deleteDomainPack(id);
      if (!res.ok) {
        setMessage(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 200,
          }) || 'Uninstall failed',
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('nav.domain-packs')}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Built-in and custom Domain Packs (workers + prompt/skill blocks). Install from a local
          folder or zip with <code className="text-xs">pack.json</code> (
          <code className="text-xs">neos-domain-pack/v1</code>).
        </p>
      </div>

      <div
        className="mb-6 space-y-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div>
          <label className="mb-2 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Install from local path
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="/path/to/my-pack"
              data-testid="domain-pack-path"
              className="min-w-[240px] flex-1 rounded-md border px-3 py-2 text-sm"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={busy}
              data-testid="domain-pack-install-path"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
              }}
            >
              Install
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            data-testid="domain-pack-zip-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleInstallZip(f);
            }}
          />
          <input
            ref={validateInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="domain-pack-validate-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleValidateFile(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            data-testid="domain-pack-install-zip"
            onClick={() => zipInputRef.current?.click()}
            className="rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          >
            Install from zip…
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="domain-pack-validate"
            onClick={() => validateInputRef.current?.click()}
            className="rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
          >
            Validate pack.json…
          </button>
        </div>

        {message && (
          <p
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
            data-testid="domain-pack-message"
            role="status"
          >
            {message}
          </p>
        )}
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('common.loading')}
        </p>
      ) : (
        <div className="grid gap-3">
          {packs.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {scrubDisplayText(p.name, { maxChars: 80 }) || p.id}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {p.isBuiltIn ? 'built-in' : 'custom'}
                  </span>
                  {p.version && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      v{scrubDisplayText(p.version, { maxChars: 20 })}
                    </span>
                  )}
                  {!p.isBuiltIn && p.enabled === false && (
                    <span className="text-xs text-yellow-500">disabled</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {scrubDisplayText(p.description ?? '', { maxChars: 200 })}
                  {' · '}
                  {p.workerCount ?? 0} workers · {p.blockCount ?? 0} blocks
                  <span className="opacity-70"> · {p.id}</span>
                </p>
              </div>
              {!p.isBuiltIn && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleToggle(p.id, p.enabled === false)}
                    className="rounded-md px-3 py-1.5 text-xs"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {p.enabled === false ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDelete(p.id)}
                    className="rounded-md px-3 py-1.5 text-xs text-red-400"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  >
                    Uninstall
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
