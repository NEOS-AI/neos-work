/**
 * Collab awareness chrome (v0.6 M1 + v0.7 M2 selection) — avatars + peer list popover.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import type { PeerSelectionInfo, PresencePeerInfo } from './types.js';

export interface PresencePeersBarProps {
  /** Other peers (not self). */
  peers: PresencePeerInfo[];
  self?: PresencePeerInfo | null;
  /**
   * sessionId → current editing selection (path + selector).
   * Used for peer indicators under names (v0.7 M2).
   */
  selections?: Record<string, PeerSelectionInfo | undefined>;
  className?: string;
  /** Compact label when alone. */
  soloLabel?: string;
  listTitle?: string;
}

function formatSelectionHint(sel?: PeerSelectionInfo | null): string | null {
  if (!sel) return null;
  const path = sel.path?.trim() || '';
  const multi = Array.isArray(sel.selectors) ? sel.selectors.filter(Boolean) : [];
  const multiN = multi.length > 1 ? multi.length : 0;
  const selector = sel.selector?.trim() || multi[multi.length - 1] || '';
  if (!path && !selector && multiN === 0) return null;
  const base = path
    ? path.includes('/')
      ? path.slice(path.lastIndexOf('/') + 1)
      : path
    : '';
  if (multiN > 1) {
    const shortSel = selector.length > 24 ? `${selector.slice(0, 22)}…` : selector;
    if (base && shortSel) return `${base} · ${multiN} sel · ${shortSel}`;
    if (base) return `${base} · ${multiN} selected`;
    return `${multiN} selected · ${shortSel || '…'}`;
  }
  if (path && selector) {
    const shortSel = selector.length > 36 ? `${selector.slice(0, 34)}…` : selector;
    return `${base} · ${shortSel}`;
  }
  if (path) return base;
  return selector.length > 40 ? `${selector.slice(0, 38)}…` : selector;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function avatarStyle(hint?: number): CSSProperties {
  const h = typeof hint === 'number' && Number.isFinite(hint) ? hint % 360 : 220;
  return {
    backgroundColor: `hsl(${h} 55% 38%)`,
    color: '#fff',
    width: 22,
    height: 22,
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 600,
    flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.15)',
  };
}

export function PresencePeersBar({
  peers,
  self = null,
  selections = {},
  className,
  soloLabel = 'Solo',
  listTitle = 'On this project',
}: PresencePeersBarProps) {
  const [open, setOpen] = useState(false);
  const others = useMemo(
    () => peers.filter((p) => p.sessionId && p.sessionId !== self?.sessionId),
    [peers, self?.sessionId],
  );
  const count = others.length;
  const shown = others.slice(0, 4);
  const extra = Math.max(0, count - shown.length);
  const selectingCount = useMemo(
    () =>
      others.filter((p) => {
        const h = formatSelectionHint(selections[p.sessionId]);
        return Boolean(h);
      }).length,
    [others, selections],
  );

  return (
    <div
      className={className}
      data-testid="collab-peers"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <button
        type="button"
        data-testid="collab-peers-toggle"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        title={count === 0 ? soloLabel : `${count} peer${count === 1 ? '' : 's'}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid var(--border-primary, #333)',
          background: 'var(--bg-tertiary, #2a2a2a)',
          color: 'var(--text-secondary, #bbb)',
          borderRadius: 999,
          padding: '2px 8px 2px 4px',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        <span style={{ display: 'inline-flex', flexDirection: 'row-reverse' }}>
          {self && (
            <span
              style={{ ...avatarStyle(self.colorHint), marginLeft: shown.length ? -6 : 0, zIndex: 5 }}
              title={`${self.displayName} (you)`}
              data-testid="collab-self-avatar"
            >
              {initials(self.displayName)}
            </span>
          )}
          {shown.map((p, i) => {
            const hint = formatSelectionHint(selections[p.sessionId]);
            return (
              <span
                key={p.sessionId}
                style={{
                  ...avatarStyle(p.colorHint),
                  marginLeft: i === 0 && !self ? 0 : -6,
                  zIndex: 4 - i,
                  boxShadow: hint
                    ? `0 0 0 2px hsl(${(p.colorHint ?? 220) % 360} 70% 55%)`
                    : undefined,
                }}
                title={hint ? `${p.displayName}: ${hint}` : p.displayName}
                data-testid={`collab-peer-avatar-${p.sessionId.slice(0, 6)}`}
              >
                {initials(p.displayName)}
              </span>
            );
          })}
          {extra > 0 && (
            <span
              style={{
                ...avatarStyle(0),
                backgroundColor: 'var(--bg-secondary, #1a1a1a)',
                marginLeft: -6,
                fontSize: 9,
              }}
            >
              +{extra}
            </span>
          )}
        </span>
        <span data-testid="collab-peers-label">
          {count === 0
            ? soloLabel
            : selectingCount > 0
              ? `${count} peer${count === 1 ? '' : 's'} · ${selectingCount} selecting`
              : `${count} peer${count === 1 ? '' : 's'}`}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          data-testid="collab-peers-list"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            minWidth: 180,
            zIndex: 50,
            borderRadius: 8,
            border: '1px solid var(--border-primary, #333)',
            background: 'var(--bg-secondary, #1a1a1a)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            padding: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted, #888)',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {listTitle}
          </div>
          {self && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 12 }}
              data-testid="collab-peer-row-self"
            >
              <span style={avatarStyle(self.colorHint)}>{initials(self.displayName)}</span>
              <span style={{ color: 'var(--text-primary, #eee)' }}>
                {self.displayName} <span style={{ color: 'var(--text-muted, #888)' }}>(you)</span>
              </span>
            </div>
          )}
          {others.map((p) => {
            const hint = formatSelectionHint(selections[p.sessionId]);
            return (
              <div
                key={p.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '4px 2px',
                  fontSize: 12,
                }}
                data-testid={`collab-peer-row-${p.sessionId.slice(0, 6)}`}
              >
                <span style={avatarStyle(p.colorHint)}>{initials(p.displayName)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: 'var(--text-primary, #eee)' }}>{p.displayName}</div>
                  {hint && (
                    <div
                      data-testid={`collab-peer-selection-${p.sessionId.slice(0, 6)}`}
                      title={hint}
                      style={{
                        fontSize: 10,
                        color: 'var(--text-muted, #888)',
                        fontFamily: 'ui-monospace, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}
                    >
                      {hint}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {others.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '4px 2px' }}>
              No other sessions
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              marginTop: 6,
              width: '100%',
              fontSize: 11,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted, #888)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
