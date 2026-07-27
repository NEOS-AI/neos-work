import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { resolvePresetWidth } from './device-presets.js';
import {
  NEOS_BRIDGE_SOURCE,
  isBridgeInbound,
  type BridgeInboundMessage,
  type BridgeOutboundCommand,
} from './bridge-types.js';
import { injectBridgeIntoHtml } from './bridge-inject.js';

export interface PreviewFrameProps {
  /** HTML (or wrapped text) document for srcDoc. */
  html: string;
  /** Bump to force iframe reload (e.g. after save). */
  reloadKey?: number | string;
  devicePresetId?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Inject Inspect/Layers bridge script into srcDoc. */
  bridgeEnabled?: boolean;
  /** Enable inspect click-to-select inside iframe. */
  inspectEnabled?: boolean;
  onBridgeMessage?: (msg: BridgeInboundMessage) => void;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** If content does not look like HTML, wrap in a readable pre document. */
export function toPreviewDocument(content: string, filePath?: string | null): string {
  const trimmed = content.trimStart();
  const looksHtml =
    trimmed.startsWith('<!DOCTYPE')
    || trimmed.startsWith('<!doctype')
    || trimmed.startsWith('<html')
    || (filePath?.endsWith('.html') ?? false)
    || (filePath?.endsWith('.htm') ?? false);
  if (looksHtml) return content;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{margin:0;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1rem;white-space:pre-wrap}
  </style></head><body>${escapeHtml(content)}</body></html>`;
}

export function postToPreview(
  iframe: HTMLIFrameElement | null,
  cmd: BridgeOutboundCommand,
): void {
  if (!iframe?.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(
      { source: NEOS_BRIDGE_SOURCE, ...cmd },
      '*',
    );
  } catch {
    // ignore
  }
}

export function PreviewFrame({
  html,
  reloadKey = 0,
  devicePresetId = 'fluid',
  title = 'design-preview',
  className,
  style,
  bridgeEnabled = true,
  inspectEnabled = false,
  onBridgeMessage,
}: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onBridgeRef = useRef(onBridgeMessage);
  onBridgeRef.current = onBridgeMessage;

  const width = resolvePresetWidth(devicePresetId);
  const frameStyle = useMemo((): CSSProperties => {
    const base: CSSProperties = {
      border: 0,
      background: '#fff',
      display: 'block',
      minHeight: 0,
      flex: 1,
      height: '100%',
      ...style,
    };
    if (width === '100%') {
      base.width = '100%';
    } else {
      base.width = width;
      base.maxWidth = '100%';
      base.margin = '0 auto';
      base.boxShadow = '0 0 0 1px rgba(0,0,0,0.08)';
    }
    return base;
  }, [width, style]);

  const srcDoc = useMemo(() => {
    return bridgeEnabled ? injectBridgeIntoHtml(html) : html;
  }, [html, bridgeEnabled]);

  // Listen for bridge messages from iframe
  useEffect(() => {
    if (!bridgeEnabled) return;
    const handler = (ev: MessageEvent) => {
      if (!isBridgeInbound(ev.data)) return;
      onBridgeRef.current?.(ev.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [bridgeEnabled]);

  // Sync inspect mode to iframe
  useEffect(() => {
    if (!bridgeEnabled) return;
    postToPreview(iframeRef.current, { type: 'neos.set-inspect', enabled: inspectEnabled });
  }, [inspectEnabled, bridgeEnabled, reloadKey, srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      key={String(reloadKey)}
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className={className}
      style={frameStyle}
      data-testid="preview-frame"
      data-inspect={inspectEnabled ? '1' : '0'}
    />
  );
}
