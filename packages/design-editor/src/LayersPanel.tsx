/**
 * Figma-like Layers tree panel (Task 1c / Q13).
 * v0.9 M0: sibling drag-reorder (same parent only).
 */

import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import type { LayerNode } from '@neos-work/shared';
import { filterLayers } from './html-layers.js';

const DND_MIME = 'application/x-neos-layer-id';

/** Drop payload for sibling reorder (v0.9 M0). Primary only when multi-select. */
export type LayerReorderPayload = {
  source: LayerNode;
  target: LayerNode;
  /** Insert source immediately before or after target (same parent). */
  position: 'before' | 'after';
  /** Parent layer id, or null for root-level list. */
  parentId: string | null;
};

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
   * Layer select. Second arg reports Shift/meta/ctrl for multi-select (v0.7 M3 + v0.8.5).
   */
  onSelect?: (layer: LayerNode, opts?: { additive?: boolean }) => void;
  onHover?: (layer: LayerNode | null) => void;
  onToggleVisibility?: (layer: LayerNode, visible: boolean) => void;
  onToggleLock?: (layer: LayerNode, locked: boolean) => void;
  onEditWithAi?: (layer: LayerNode) => void;
  onCopySelector?: (layer: LayerNode) => void;
  /**
   * Sibling reorder (v0.9 M0). Same-parent only; panel enforces parent match.
   * Disabled when filter is active, or when `reorderEnabled` is false.
   */
  onReorderSibling?: (payload: LayerReorderPayload) => void;
  /**
   * Allow drag-reorder. Default: true when `onReorderSibling` is set and source is not JSX.
   */
  reorderEnabled?: boolean;
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
    reorderDisabled?: string;
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
  reorderDisabled: 'Reorder is HTML-only (clear filter; not available for JSX)',
};

function LayerRow({
  layer,
  parentId,
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
  reorderActive,
  dragLayerId,
  dropHint,
  onDragLayerStart,
  onDragLayerEnd,
  onDragLayerOver,
  onDropOnLayer,
}: {
  layer: LayerNode;
  parentId: string | null;
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
  reorderActive: boolean;
  dragLayerId: string | null;
  dropHint: { id: string; position: 'before' | 'after' } | null;
  onDragLayerStart: (layer: LayerNode, parentId: string | null) => void;
  onDragLayerEnd: () => void;
  onDragLayerOver: (
    e: DragEvent,
    layer: LayerNode,
    parentId: string | null,
  ) => void;
  onDropOnLayer: (
    e: DragEvent,
    layer: LayerNode,
    parentId: string | null,
  ) => void;
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
  const canDrag = reorderActive && !layer.locked;
  const isDropBefore =
    dropHint?.id === layer.id && dropHint.position === 'before';
  const isDropAfter =
    dropHint?.id === layer.id && dropHint.position === 'after';
  const isDragging = dragLayerId === layer.id;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        draggable={canDrag}
        data-testid={`layer-row-${layer.id}`}
        data-layer-id={layer.id}
        data-parent-id={parentId ?? ''}
        data-selected={selected ? '1' : undefined}
        data-multi-selected={multiSelected && !primarySelected ? '1' : undefined}
        data-drop-before={isDropBefore ? '1' : undefined}
        data-drop-after={isDropAfter ? '1' : undefined}
        data-dragging={isDragging ? '1' : undefined}
        onClick={(e) =>
          onSelect?.(layer, {
            additive: Boolean(e.shiftKey || e.metaKey || e.ctrlKey),
          })
        }
        onMouseEnter={() => onHover?.(layer)}
        onMouseLeave={() => onHover?.(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          // Minimal: copy selector + edit with AI via shift/meta free actions below
          if (e.shiftKey) onContextEdit?.(layer);
          else onContextCopy?.(layer);
        }}
        onDragStart={(e) => {
          if (!canDrag) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(DND_MIME, layer.id);
          e.dataTransfer.setData('text/plain', layer.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragLayerStart(layer, parentId);
        }}
        onDragEnd={() => onDragLayerEnd()}
        onDragOver={(e) => onDragLayerOver(e, layer, parentId)}
        onDrop={(e) => onDropOnLayer(e, layer, parentId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          paddingLeft: 6 + layer.depth * 12,
          fontSize: 11,
          cursor: canDrag ? 'grab' : 'pointer',
          background: primarySelected
            ? 'color-mix(in srgb, var(--accent, #6366f1) 28%, transparent)'
            : multiSelected
              ? 'color-mix(in srgb, var(--accent, #6366f1) 14%, transparent)'
              : 'transparent',
          color: layer.visible ? 'var(--text-primary, inherit)' : 'var(--text-muted, #888)',
          opacity: isDragging ? 0.4 : layer.visible ? 1 : 0.55,
          borderRadius: 4,
          userSelect: 'none',
          boxShadow: isDropBefore
            ? 'inset 0 2px 0 0 var(--accent, #6366f1)'
            : isDropAfter
              ? 'inset 0 -2px 0 0 var(--accent, #6366f1)'
              : undefined,
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
        {canDrag && (
          <span
            aria-hidden
            data-testid={`layer-drag-${layer.id}`}
            style={{
              fontSize: 9,
              color: 'var(--text-muted, #666)',
              letterSpacing: -1,
              lineHeight: 1,
            }}
          >
            ⋮⋮
          </span>
        )}
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
            parentId={layer.id}
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
            reorderActive={reorderActive}
            dragLayerId={dragLayerId}
            dropHint={dropHint}
            onDragLayerStart={onDragLayerStart}
            onDragLayerEnd={onDragLayerEnd}
            onDragLayerOver={onDragLayerOver}
            onDropOnLayer={onDropOnLayer}
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
  onReorderSibling,
  reorderEnabled: reorderEnabledProp,
  labels: labelsProp,
  className,
  style,
}: LayersPanelProps) {
  const labels = { ...defaultLabels, ...labelsProp };
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragParentId, setDragParentId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);

  const filtered = useMemo(() => filterLayers(layers, query), [layers, query]);
  const filterActive = query.trim().length > 0;
  const jsxSource = source === 'jsx' || source === 'jsx-partial';
  const reorderActive =
    Boolean(onReorderSibling)
    && (reorderEnabledProp ?? !jsxSource)
    && !filterActive;

  const layerById = useMemo(() => {
    const map = new Map<string, LayerNode>();
    const walk = (nodes: LayerNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(layers);
    return map;
  }, [layers]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearDrag = () => {
    setDragLayerId(null);
    setDragParentId(null);
    setDropHint(null);
  };

  const onDragLayerStart = (layer: LayerNode, parentId: string | null) => {
    setDragLayerId(layer.id);
    setDragParentId(parentId);
  };

  const resolveDropPosition = (
    e: DragEvent,
    el: EventTarget | null,
  ): 'before' | 'after' => {
    const nativeY = e.nativeEvent?.clientY;
    const clientY =
      typeof e.clientY === 'number' && e.clientY !== 0
        ? e.clientY
        : typeof nativeY === 'number'
          ? nativeY
          : 0;
    const rect =
      el && 'getBoundingClientRect' in el
        ? (el as HTMLElement).getBoundingClientRect()
        : { top: 0, height: 0 };
    // Zero-height (jsdom): prefer "before" so drops remain meaningful in tests/hosts without layout
    if (!rect.height) return 'before';
    const mid = rect.top + rect.height / 2;
    return clientY < mid ? 'before' : 'after';
  };

  const onDragLayerOver = (
    e: DragEvent,
    layer: LayerNode,
    parentId: string | null,
  ) => {
    if (!reorderActive || !dragLayerId) return;
    if (dragLayerId === layer.id) return;
    // Q24: same parent only
    if (parentId !== dragParentId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const position = resolveDropPosition(e, e.currentTarget);
    setDropHint((prev) =>
      prev?.id === layer.id && prev.position === position
        ? prev
        : { id: layer.id, position },
    );
  };

  const onDropOnLayer = (
    e: DragEvent,
    target: LayerNode,
    parentId: string | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!reorderActive || !onReorderSibling) {
      clearDrag();
      return;
    }
    const raw =
      e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData('text/plain');
    const sourceId = raw || dragLayerId;
    if (!sourceId || sourceId === target.id) {
      clearDrag();
      return;
    }
    if (parentId !== dragParentId) {
      clearDrag();
      return;
    }
    const source = layerById.get(sourceId);
    if (!source || source.locked) {
      clearDrag();
      return;
    }
    const position =
      dropHint?.id === target.id
        ? dropHint.position
        : resolveDropPosition(e, e.currentTarget);
    onReorderSibling({
      source,
      target,
      position,
      parentId,
    });
    clearDrag();
  };

  return (
    <div
      className={className}
      data-testid="layers-panel"
      data-reorder={reorderActive ? '1' : '0'}
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
      {onReorderSibling && !reorderActive && (
        <div
          data-testid="layers-reorder-hint"
          title={labels.reorderDisabled}
          style={{
            padding: '4px 8px',
            fontSize: 9,
            color: 'var(--text-muted, #888)',
            borderBottom: '1px solid var(--border-primary, #333)',
          }}
        >
          {jsxSource
            ? labels.reorderDisabled
            : filterActive
              ? 'Clear filter to reorder layers'
              : labels.reorderDisabled}
        </div>
      )}
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
              parentId={null}
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
              reorderActive={reorderActive}
              dragLayerId={dragLayerId}
              dropHint={dropHint}
              onDragLayerStart={onDragLayerStart}
              onDragLayerEnd={clearDrag}
              onDragLayerOver={onDragLayerOver}
              onDropOnLayer={onDropOnLayer}
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
