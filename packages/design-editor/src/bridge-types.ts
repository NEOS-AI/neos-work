/**
 * postMessage bridge protocol between Preview iframe and parent (M3 Inspect/Layers).
 * Types only in v0.5.2 — full inject lands with Task 1c.
 */

export const NEOS_BRIDGE_SOURCE = 'neos-design-editor' as const;

export type BridgeMessageType =
  | 'neos.ready'
  | 'neos.dom-snapshot'
  | 'neos.select'
  | 'neos.hover'
  | 'neos.scroll'
  | 'neos.pong'
  | 'neos.measure-result';

export interface BridgeMessageBase {
  source: typeof NEOS_BRIDGE_SOURCE;
  type: BridgeMessageType;
  requestId?: string;
}

export interface BridgeDomNode {
  id: string;
  tag: string;
  name: string;
  selector: string;
  depth: number;
  visible: boolean;
  locked: boolean;
  children: BridgeDomNode[];
}

export interface BridgeSelectPayload {
  selector: string;
  tag: string;
  outerHTML?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  /** True when Shift was held (v0.7 M3 multi-select). */
  additive?: boolean;
  /**
   * Full multi-selection after this click (ordered; last = primary).
   * Omitted when length ≤ 1. Nested items do not include `multi` / `additive`.
   */
  multi?: Array<{
    selector: string;
    tag: string;
    outerHTML?: string;
    bbox?: { x: number; y: number; width: number; height: number };
  }>;
}

export type BridgeMeasureItem = {
  selector: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
};

export type BridgeInboundMessage =
  | (BridgeMessageBase & { type: 'neos.ready' })
  | (BridgeMessageBase & { type: 'neos.dom-snapshot'; tree: BridgeDomNode[] })
  | (BridgeMessageBase & { type: 'neos.select'; selection: BridgeSelectPayload })
  | (BridgeMessageBase & { type: 'neos.hover'; selector: string | null })
  | (BridgeMessageBase & { type: 'neos.scroll'; x: number; y: number })
  | (BridgeMessageBase & { type: 'neos.pong' })
  | (BridgeMessageBase & {
      type: 'neos.measure-result';
      requestId: string;
      results: BridgeMeasureItem[];
    });

export type BridgeOutboundCommand =
  | { type: 'neos.ping' }
  | { type: 'neos.request-snapshot' }
  | { type: 'neos.highlight'; selector: string | null }
  /** Multi-outline; last selector is primary (v0.7 M3). */
  | { type: 'neos.highlight-multi'; selectors: string[] }
  | { type: 'neos.scroll-to'; selector: string }
  | { type: 'neos.set-inspect'; enabled: boolean }
  /** Measure layout boxes for selectors (v0.8.6 peer outlines). */
  | { type: 'neos.measure'; selectors: string[]; requestId: string };

export function isBridgeInbound(data: unknown): data is BridgeInboundMessage {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const o = data as Record<string, unknown>;
  if (o.source !== NEOS_BRIDGE_SOURCE) return false;
  if (typeof o.type !== 'string' || !o.type.startsWith('neos.')) return false;
  return true;
}
