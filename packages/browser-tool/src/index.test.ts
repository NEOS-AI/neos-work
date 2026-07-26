import { describe, expect, it } from 'vitest';
import { BrowserManager, createBrowserTools } from './index.js';

describe('@neos-work/browser-tool barrel exports', () => {
  it('re-exports manager and tool factory', () => {
    expect(typeof BrowserManager).toBe('function');
    expect(typeof createBrowserTools).toBe('function');
  });
});
