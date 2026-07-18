import { describe, expect, it, vi } from 'vitest';

// Mock playwright so unit tests never launch Chromium.
vi.mock('playwright', () => {
  const page = { close: vi.fn() };
  const browser = {
    isConnected: vi.fn(() => true),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  return {
    chromium: {
      launch: vi.fn(async () => browser),
    },
  };
});

import { BrowserManager } from './manager.js';

describe('BrowserManager', () => {
  it('throws when getPage is called before connect', () => {
    const mgr = new BrowserManager();
    expect(() => mgr.getPage()).toThrow(/not connected/i);
    expect(mgr.isConnected()).toBe(false);
  });

  it('connect creates a page and reports connected', async () => {
    const mgr = new BrowserManager();
    await mgr.connect();
    expect(mgr.isConnected()).toBe(true);
    expect(mgr.getPage()).toBeTruthy();
    // second connect is a no-op while connected
    await mgr.connect();
    await mgr.disconnect();
    expect(mgr.isConnected()).toBe(false);
    expect(() => mgr.getPage()).toThrow(/not connected/i);
  });
});
