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

  it('includes multi-select shift handling and highlight-multi (v0.7 M3)', () => {
    const script = buildBridgeInjectScript();
    expect(script).toContain('neos-inspect-sel-multi');
    expect(script).toContain('shiftKey');
    expect(script).toContain('neos.highlight-multi');
    expect(script).toContain('additive');
    expect(script).toContain('multiPayloads');
  });

  it('treats metaKey and ctrlKey as additive multi-select (v0.8.5)', () => {
    const script = buildBridgeInjectScript();
    expect(script).toMatch(/shiftKey\s*\|\|\s*ev\.metaKey\s*\|\|\s*ev\.ctrlKey/);
  });

  it('includes neos.measure / measure-result (v0.8.6 peer outlines)', () => {
    const script = buildBridgeInjectScript();
    expect(script).toContain('neos.measure');
    expect(script).toContain('neos.measure-result');
    expect(script).toContain('getBoundingClientRect');
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
