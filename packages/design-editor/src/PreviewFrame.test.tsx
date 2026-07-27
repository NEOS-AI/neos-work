import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PreviewFrame, postToPreview, toPreviewDocument } from './PreviewFrame.js';
import { NEOS_BRIDGE_SOURCE } from './bridge-types.js';

describe('PreviewFrame', () => {
  it('renders iframe with bridge-injected srcDoc', async () => {
    const { container, unmount } = render(
      <PreviewFrame html="<html><body><p>hi</p></body></html>" devicePresetId="mobile" />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('title')).toBe('design-preview');
    // width from mobile preset applied as style
    expect(iframe?.style.width).toBe('390px');
    unmount();
  });

  it('skips bridge when disabled and uses fluid width', () => {
    const { container, unmount } = render(
      <PreviewFrame
        html="<html><body>x</body></html>"
        bridgeEnabled={false}
        devicePresetId="fluid"
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.style.width).toBe('100%');
    unmount();
  });

  it('forwards bridge messages matching source', async () => {
    const onBridge = vi.fn();
    render(
      <PreviewFrame
        html="<html><body></body></html>"
        onBridgeMessage={onBridge}
        bridgeEnabled
      />,
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: NEOS_BRIDGE_SOURCE, type: 'neos.ready' },
      }),
    );
    await waitFor(() => {
      expect(onBridge).toHaveBeenCalled();
    });
    // ignore foreign messages
    onBridge.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'other', type: 'neos.ready' },
      }),
    );
    expect(onBridge).not.toHaveBeenCalled();
  });

  it('postToPreview no-ops without contentWindow', () => {
    expect(() =>
      postToPreview(null, { type: 'neos.set-inspect', enabled: true }),
    ).not.toThrow();
  });

  it('toPreviewDocument escapes non-html', () => {
    const doc = toPreviewDocument('<script>alert(1)</script>', 'note.txt');
    expect(doc).toContain('&lt;script&gt;');
  });
});
