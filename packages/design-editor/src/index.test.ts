import { describe, expect, it } from 'vitest';
import {
  DEVICE_PRESETS,
  createEmptyBuffer,
  isBridgeInbound,
  reduceEditorBuffer,
  toPreviewDocument,
} from './index.js';

describe('@neos-work/design-editor barrel', () => {
  it('exports buffer helpers and presets', () => {
    expect(createEmptyBuffer().path).toBeNull();
    expect(DEVICE_PRESETS.length).toBeGreaterThan(2);
    const s = reduceEditorBuffer(createEmptyBuffer(), {
      type: 'open',
      path: 'x.html',
      content: '<p>a</p>',
    });
    expect(s.local).toContain('a');
  });

  it('toPreviewDocument wraps non-html', () => {
    const doc = toPreviewDocument('plain text', 'notes.txt');
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('plain text');
    expect(toPreviewDocument('<html></html>', 'index.html')).toContain('<html');
  });

  it('isBridgeInbound validates source', () => {
    expect(isBridgeInbound({ source: 'neos-design-editor', type: 'neos.ready' })).toBe(true);
    expect(isBridgeInbound({ source: 'other', type: 'neos.ready' })).toBe(false);
    expect(isBridgeInbound(null)).toBe(false);
  });
});
