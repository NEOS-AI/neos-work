/**
 * Presentational NEOS-as-MCP install panel (List B / ui-app).
 * Host loads install-info + Codex status and wires actions.
 */

import { useState } from 'react';
import type { CodexMcpStatus, McpInstallInfo } from './types.js';

export interface McpInstallPanelProps {
  info: McpInstallInfo | null;
  codexStatus?: CodexMcpStatus | null;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  hideToken?: boolean;
  onHideTokenChange?: (hide: boolean) => void;
  onRefresh?: () => void;
  onInstallCodex?: () => void;
  onUninstallCodex?: () => void;
  /** When false, hide Codex install/remove controls (e.g. web without local CLI). */
  showCodexActions?: boolean;
  className?: string;
  title?: string;
  description?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function McpInstallPanel({
  info,
  codexStatus = null,
  loading = false,
  busy = false,
  error = null,
  hideToken = true,
  onHideTokenChange,
  onRefresh,
  onInstallCodex,
  onUninstallCodex,
  showCodexActions = true,
  className,
  title = 'NEOS as MCP server',
  description = 'Expose Design Project files and live artifacts to external coding agents via neos mcp serve (stdio).',
}: McpInstallPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = async (label: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      window.alert('Clipboard unavailable');
      return;
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section
      id="mcp-expose"
      className={className}
      data-testid="mcp-expose-section"
      style={{
        borderRadius: 12,
        border: '1px solid var(--border-primary, #333)',
        padding: 20,
        backgroundColor: 'var(--bg-secondary, #1a1a1a)',
      }}
    >
      <h2
        className="mcp-panel-title"
        style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text-primary, #eee)' }}
      >
        {title}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted, #888)' }}>{description}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        {onHideTokenChange && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #bbb)' }}>
            <input
              type="checkbox"
              checked={hideToken}
              onChange={(e) => onHideTokenChange(e.target.checked)}
              data-testid="mcp-expose-hide-token"
            />
            Hide auth token in snippets
          </label>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={loading}
            data-testid="mcp-expose-refresh"
            style={{
              borderRadius: 8,
              padding: '4px 10px',
              fontSize: 12,
              border: 'none',
              cursor: loading ? 'default' : 'pointer',
              backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
              color: 'var(--text-primary, #eee)',
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" data-testid="mcp-expose-error" style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>
          {error}
        </p>
      )}

      {info && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
            Server: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{info.serverName ?? 'neos-work'}</span>
            {info.version ? ` · v${info.version}` : ''}
            {info.tools && info.tools.length > 0 ? ` · ${info.tools.length} tools` : ''}
          </div>

          {info.tools && info.tools.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }} data-testid="mcp-expose-tools">
              {info.tools.map((t) => (
                <span
                  key={t.name}
                  title={t.description}
                  style={{
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
                    color: 'var(--text-secondary, #bbb)',
                  }}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {typeof info.shellSnippet === 'string' && info.shellSnippet && (
            <SnippetBlock
              label="Shell / env"
              text={info.shellSnippet}
              copied={copied === 'shell'}
              onCopy={() => void copyText('shell', info.shellSnippet!)}
              testId="mcp-expose-shell"
              copyTestId="mcp-expose-copy-shell"
            />
          )}

          {info.claudeDesktop != null && (
            <SnippetBlock
              label="Claude Desktop / Cursor mcpServers"
              text={JSON.stringify(info.claudeDesktop, null, 2)}
              copied={copied === 'claude'}
              onCopy={() => void copyText('claude', JSON.stringify(info.claudeDesktop, null, 2))}
              testId="mcp-expose-claude"
              copyTestId="mcp-expose-copy-claude"
              copyLabel={copied === 'claude' ? 'Copied' : 'Copy JSON'}
            />
          )}

          {typeof info.codexAddCommand === 'string' && info.codexAddCommand && (
            <SnippetBlock
              label="Codex CLI"
              text={info.codexAddCommand}
              copied={copied === 'codex'}
              onCopy={() => void copyText('codex', info.codexAddCommand!)}
              testId="mcp-expose-codex-cmd"
              copyTestId="mcp-expose-copy-codex"
            />
          )}

          {showCodexActions && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }} data-testid="mcp-expose-codex-status">
                Codex:{' '}
                {codexStatus == null
                  ? '…'
                  : !codexStatus.available
                    ? 'CLI not found'
                    : codexStatus.installed
                      ? 'neos-work installed'
                      : 'available (not installed)'}
                {codexStatus?.detail ? ` — ${codexStatus.detail}` : ''}
              </span>
              {onInstallCodex && (
                <button
                  type="button"
                  disabled={busy || codexStatus?.available === false}
                  onClick={() => onInstallCodex()}
                  data-testid="mcp-expose-codex-install"
                  style={{
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    border: 'none',
                    backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
                    color: 'var(--text-primary, #eee)',
                  }}
                >
                  {busy ? '…' : 'Install in Codex'}
                </button>
              )}
              {onUninstallCodex && codexStatus?.installed && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onUninstallCodex()}
                  data-testid="mcp-expose-codex-uninstall"
                  style={{
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    border: 'none',
                    backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
                    color: 'var(--text-primary, #eee)',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!info && !loading && !error && (
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>No install info loaded.</p>
      )}
    </section>
  );
}

function SnippetBlock(props: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  testId: string;
  copyTestId: string;
  copyLabel?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, #bbb)' }}>{props.label}</span>
        <button
          type="button"
          onClick={props.onCopy}
          data-testid={props.copyTestId}
          style={{ fontSize: 11, border: 'none', background: 'none', color: 'var(--accent, #818cf8)', cursor: 'pointer' }}
        >
          {props.copyLabel ?? (props.copied ? 'Copied' : 'Copy')}
        </button>
      </div>
      <pre
        data-testid={props.testId}
        style={{
          maxHeight: 160,
          overflow: 'auto',
          borderRadius: 8,
          border: '1px solid var(--border-secondary, #444)',
          padding: 8,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
          color: 'var(--text-primary, #eee)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          margin: 0,
        }}
      >
        {props.text}
      </pre>
    </div>
  );
}
