/**
 * Figma-like Layers tree panel (Task 1c / Q13).
 */

import { useMemo, useState, type CSSProperties } from 'react';
import type { LayerNode } from '@neos-work/shared';
import { filterLayers } from './html-layers.js';

export interface LayersPanelProps {
  layers: LayerNode[];
  selectedLayerId?: string | null;
  selectedSelector?: string | null;
  /** Additional selected layer ids (v0.7 M3 multi-select). */
  selectedLayerIds?: string[];
  /** Additional selected selectors (v0.7 M3). */
  selectedSelectors?: string[];
  /** Source badge: live bridge snapshot vs HTML/JSX parse fallback. */
  source?: 'bridge' | 'parse' | 'jsx' | 'jsx-partial';
  /**
   * Layer select. Second arg reports Shift/meta for multi-select (v0.7 M3).
   */
  onSelect?: (layer: LayerNode, opts?: { additive?: boolean }) => void;
  onHover?: (layer: LayerNode | null) => void;
  onToggleVisibility?: (layer: LayerNode, visible: boolean) => void;
  onToggleLock?: (layer: LayerNode, locked: boolean) => void;
  onEditWithAi?: (layer: LayerNode) => void;
  onCopySelector?: (layer: LayerNode) => void;
  labels?: {
    title?: string;
    search?: string;
    empty?: string;
    sourceBridge?: string;
    sourceParse?: string;
    sourceJsx?: string;
    sourceJsxPartial?: string;
    editWithAi?: string;
    copySelector?: string;
  };
  className?: string;
  style?: CSSProperties;
}

const defaultLabels = {
  title: 'Layers',
  search: 'Filter layers…',
  empty: 'No layers',
  sourceBridge: 'Live',
  sourceParse: 'Parse',
  sourceJsx: 'JSX',
  sourceJsxPartial: 'JSX~',
  editWithAi: 'Edit with AI',
  copySelector: 'Copy selector',
};

function LayerRow({
  layer,
  selectedLayerId,
  selectedSelector,
  selectedLayerIds,
  selectedSelectors,
  collapsed,
  onToggleCollapse,
  onSelect,
  onHover,
  onToggleVisibility,
  onToggleLock,
  onContextEdit,
  onContextCopy,
}: {
  layer: LayerNode;
  selectedLayerId?: string | null;
  selectedSelector?: string | null;
  selectedLayerIds?: string[];
  selectedSelectors?: string[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onSelect?: (layer: LayerNode, opts?: { additive?: boolean }) => void;
  onHover?: (layer: LayerNode | null) => void;
  onToggleVisibility?: (layer: LayerNode, visible: boolean) => void;
  onToggleLock?: (layer: LayerNode, locked: boolean) => void;
  onContextEdit?: (layer: LayerNode) => void;
  onContextCopy?: (layer: LayerNode) => void;
}) {
  const hasKids = layer.children.length > 0;
  const isCollapsed = collapsed.has(layer.id);
  const primarySelected =
    (selectedLayerId != null && selectedLayerId === layer.id)
    || (selectedSelector != null
      && selectedSelector !== ''
      && selectedSelector === layer.selector);
  const multiSelected =
    (selectedLayerIds?.includes(layer.id) ?? false)
    || (selectedSelectors?.includes(layer.selector) ?? false);
  const selected = primarySelected || multiSelected;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        data-testid={`layer-row-${layer.id}`}
        data-layer-id={layer.id}
        data-selected={selected ? '1' : undefined}
        data-multi-selected={multiSelected && !primarySelected ? '1' : undefined}
        onClick={(e) =>
          onSelect?.(layer, { additive: Boolean(e.shiftKey || e.metaKey) })
        }
        onMouseEnter={() => onHover?.(layer)}
        onMouseLeave={() => onHover?.(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Minimal: copy selector + edit with AI via shift/meta free actions below
          if (e.shiftKey) onContextEdit?.(layer);
          else onContextCopy?.(layer);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          paddingLeft: 6 + layer.depth * 12,
          fontSize: 11,
          cursor: 'pointer',
          background: primarySelected
            ? 'color-mix(in srgb, var(--accent, #6366f1) 28%, transparent)'
            : multiSelected
              ? 'color-mix(in srgb, var(--accent, #6366f1) 14%, transparent)'
              : 'transparent',
          color: layer.visible ? 'var(--text-primary, inherit)' : 'var(--text-muted, #888)',
          opacity: layer.visible ? 1 : 0.55,
          borderRadius: 4,
          userSelect: 'none',
        }}
        title={layer.selector}
      >
        <button
          type="button"
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          disabled={!hasKids}
          onClick={(e) => {
            e.stopPropagation();
            if (hasKids) onToggleCollapse(layer.id);
          }}
          style={{
            width: 14,
            border: 0,
            background: 'transparent',
            color: 'var(--text-muted, #888)',
            cursor: hasKids ? 'pointer' : 'default',
            padding: 0,
            fontSize: 10,
            opacity: hasKids ? 1 : 0.2,
          }}
        >
          {hasKids ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {layer.name}
        </span>
        <button
          type="button"
          aria-label={layer.visible ? 'Hide' : 'Show'}
          data-testid={`layer-vis-${layer.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility?.(layer, !layer.visible);
          }}
          style={{
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 10,
            color: 'var(--text-muted, #888)',
            padding: '0 2px',
          }}
        >
          {layer.visible ? '👁' : '👁‍🗨'}
        </button>
        <button
          type="button"
          aria-label={layer.locked ? 'Unlock' : 'Lock'}
          data-testid={`layer-lock-${layer.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock?.(layer, !layer.locked);
          }}
          style={{
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 10,
            color: layer.locked ? '#fbbf24' : 'var(--text-muted, #888)',
            padding: '0 2px',
          }}
        >
          {layer.locked ? '🔒' : '🔓'}
        </button>
      </div>
      {hasKids && !isCollapsed &&
        layer.children.map((c) => (
          <LayerRow
            key={c.id}
            layer={c}
            selectedLayerId={selectedLayerId}
            selectedSelector={selectedSelector}
            selectedLayerIds={selectedLayerIds}
            selectedSelectors={selectedSelectors}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onSelect={onSelect}
            onHover={onHover}
            onToggleVisibility={onToggleVisibility}
            onToggleLock={onToggleLock}
            onContextEdit={onContextEdit}
            onContextCopy={onContextCopy}
          />
        ))}
    </>
  );
}

export function LayersPanel({
  layers,
  selectedLayerId,
  selectedSelector,
  selectedLayerIds,
  selectedSelectors,
  source = 'parse',
  onSelect,
  onHover,
  onToggleVisibility,
  onToggleLock,
  onEditWithAi,
  onCopySelector,
  labels: labelsProp,
  className,
  style,
}: LayersPanelProps) {
  const labels = { ...defaultLabels, ...labelsProp };
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => filterLayers(layers, query), [layers, query]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className={className}
      data-testid="layers-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        borderRight: '1px solid var(--border-primary, #333)',
        background: 'var(--bg-secondary, #1a1a1a)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-primary, #333)',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted, #888)',
        }}
      >
        <span>{labels.title}</span>
        <span
          data-testid="layers-source"
          style={{
            marginLeft: 'auto',
            fontWeight: 500,
            textTransform: 'none',
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 4,
            background:
              source === 'bridge'
                ? 'rgba(16,185,129,0.15)'
                : source === 'jsx' || source === 'jsx-partial'
                  ? 'rgba(167,139,250,0.18)'
                  : 'rgba(148,163,184,0.15)',
            color:
              source === 'bridge'
                ? '#6ee7b7'
                : source === 'jsx' || source === 'jsx-partial'
                  ? '#c4b5fd'
                  : '#94a3b8',
          }}
        >
          {source === 'bridge'
            ? labels.sourceBridge
            : source === 'jsx'
              ? labels.sourceJsx
              : source === 'jsx-partial'
                ? labels.sourceJsxPartial
                : labels.sourceParse}
        </span>
      </div>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-primary, #333)' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          data-testid="layers-filter"
          style={{
            width: '100%',
            fontSize: 11,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid var(--border-primary, #333)',
            background: 'var(--bg-primary, #111)',
            color: 'var(--text-primary, #eee)',
          }}
        />
      </div>
      <div
        role="tree"
        aria-label={labels.title}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}
      >
        {filtered.length === 0 ? (
          <div
            data-testid="layers-empty"
            style={{ padding: 12, fontSize: 11, color: 'var(--text-muted, #888)' }}
          >
            {labels.empty}
          </div>
        ) : (
          filtered.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              selectedLayerId={selectedLayerId}
              selectedSelector={selectedSelector}
              selectedLayerIds={selectedLayerIds}
              selectedSelectors={selectedSelectors}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              onSelect={onSelect}
              onHover={onHover}
              onToggleVisibility={onToggleVisibility}
              onToggleLock={onToggleLock}
              onContextEdit={onEditWithAi}
              onContextCopy={onCopySelector}
            />
          ))
        )}
      </div>
      {(onEditWithAi || onCopySelector) && selectedLayerId && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 6,
            borderTop: '1px solid var(--border-primary, #333)',
          }}
        >
          {onCopySelector && (
            <button
              type="button"
              data-testid="layers-copy-selector"
              style={actionBtnStyle}
              onClick={() => {
                const flat = flattenFind(layers, selectedLayerId);
                if (flat) onCopySelector(flat);
              }}
            >
              {labels.copySelector}
            </button>
          )}
          {onEditWithAi && (
            <button
              type="button"
              data-testid="layers-edit-ai"
              style={{ ...actionBtnStyle, background: 'var(--accent, #6366f1)', color: '#fff', border: 0 }}
              onClick={() => {
                const flat = flattenFind(layers, selectedLayerId);
                if (flat) onEditWithAi(flat);
              }}
            >
              {labels.editWithAi}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: CSSProperties = {
  flex: 1,
  fontSize: 10,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--border-primary, #333)',
  background: 'transparent',
  color: 'var(--text-secondary, #ccc)',
  cursor: 'pointer',
};

function flattenFind(nodes: LayerNode[], id: string): LayerNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = flattenFind(n.children, id);
    if (c) return c;
  }
  return null;
}
