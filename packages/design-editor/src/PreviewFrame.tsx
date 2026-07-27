import { useMemo, type CSSProperties } from 'react';
import { resolvePresetWidth } from './device-presets.js';

export interface PreviewFrameProps {
  /** HTML (or wrapped text) document for srcDoc. */
  html: string;
  /** Bump to force iframe reload (e.g. after save). */
  reloadKey?: number | string;
  devicePresetId?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
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

export function PreviewFrame({
  html,
  reloadKey = 0,
  devicePresetId = 'fluid',
  title = 'design-preview',
  className,
  style,
}: PreviewFrameProps) {
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

  return (
    <iframe
      key={String(reloadKey)}
      title={title}
      sandbox="allow-scripts"
      srcDoc={html}
      className={className}
      style={frameStyle}
    />
  );
}
