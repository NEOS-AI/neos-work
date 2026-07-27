import { describe, expect, it } from 'vitest';
import { buildBridgeInjectScript } from './bridge-inject.js';
import { NEOS_BRIDGE_SOURCE } from './bridge-types.js';

describe('bridge-inject', () => {
  it('returns self-contained IIFE with bridge source and inspect styles', () => {
    const script = buildBridgeInjectScript();
    expect(script.startsWith('(function(){')).toBe(true);
    expect(script).toContain(NEOS_BRIDGE_SOURCE);
    expect(script).toContain('neos-inspect-hl');
    expect(script).toContain('postMessage');
    expect(script).toContain('__neosBridge');
  });
});

describe('injectBridgeIntoHtml placements', () => {
  it('injects before </body>, else </html>, else appends', async () => {
    const { injectBridgeIntoHtml } = await import('./bridge-inject.js');
    const withBody = injectBridgeIntoHtml('<html><body><p>x</p></body></html>');
    expect(withBody).toMatch(/data-neos-bridge="1".*<\/body>/is);

    const onlyHtml = injectBridgeIntoHtml('<html><head></head></html>');
    expect(onlyHtml).toMatch(/data-neos-bridge="1".*<\/html>/is);

    const fragment = injectBridgeIntoHtml('<div>no shell</div>');
    expect(fragment.endsWith('</script>') || fragment.includes('data-neos-bridge')).toBe(true);
  });
});
