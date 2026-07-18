import { describe, expect, it, vi } from 'vitest';
import type { BrowserManager } from './manager.js';
import { createBrowserTools } from './tools.js';

function makeManager(page: Record<string, unknown>): BrowserManager {
  return {
    getPage: () => page,
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: () => true,
  } as unknown as BrowserManager;
}

describe('createBrowserTools', () => {
  it('registers the six browser tools', () => {
    const tools = createBrowserTools(makeManager({}));
    expect(tools.map((t) => t.name)).toEqual([
      'browser_navigate',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'browser_extract_text',
      'browser_extract_links',
    ]);
  });

  it('browser_navigate goes to url and returns title/url', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      title: vi.fn(async () => 'Hello'),
      url: vi.fn(() => 'https://example.com/'),
    };
    const tools = createBrowserTools(makeManager(page));
    const nav = tools.find((t) => t.name === 'browser_navigate')!;
    const result = await nav.execute({ url: 'https://example.com' });
    expect(page.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ title: 'Hello', url: 'https://example.com/' });
  });

  it('browser_click and browser_fill call page APIs', async () => {
    const page = {
      click: vi.fn(async () => {}),
      fill: vi.fn(async () => {}),
    };
    const tools = createBrowserTools(makeManager(page));
    const click = tools.find((t) => t.name === 'browser_click')!;
    const fill = tools.find((t) => t.name === 'browser_fill')!;
    await expect(click.execute({ selector: '#btn' })).resolves.toMatchObject({ success: true });
    await expect(fill.execute({ selector: '#name', value: 'Ada' })).resolves.toMatchObject({
      success: true,
    });
    expect(page.click).toHaveBeenCalledWith('#btn', { timeout: 10_000 });
    expect(page.fill).toHaveBeenCalledWith('#name', 'Ada', { timeout: 10_000 });
  });

  it('browser_screenshot returns base64', async () => {
    const page = {
      screenshot: vi.fn(async () => Buffer.from('png-bytes')),
    };
    const tools = createBrowserTools(makeManager(page));
    const shot = tools.find((t) => t.name === 'browser_screenshot')!;
    const result = await shot.execute({ fullPage: true });
    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: true });
    expect(result.success).toBe(true);
    expect((result.output as { screenshot: string }).screenshot).toBe(
      Buffer.from('png-bytes').toString('base64'),
    );
  });

  it('browser_extract_text uses selector or full body', async () => {
    const locator = { innerText: vi.fn(async () => 'partial') };
    const page = {
      locator: vi.fn(() => locator),
      evaluate: vi.fn(async () => 'full-body'),
    };
    const tools = createBrowserTools(makeManager(page));
    const extract = tools.find((t) => t.name === 'browser_extract_text')!;

    const withSel = await extract.execute({ selector: 'h1' });
    expect(page.locator).toHaveBeenCalledWith('h1');
    expect(withSel.output).toEqual({ text: 'partial' });

    const full = await extract.execute({});
    expect(page.evaluate).toHaveBeenCalled();
    expect(full.output).toEqual({ text: 'full-body' });
  });

  it('browser_extract_links evaluates in page context', async () => {
    const page = {
      evaluate: vi.fn(async (_fn: unknown, sel: string | null) => {
        expect(sel).toBe('nav');
        return [{ text: 'Home', href: 'https://x.test/' }];
      }),
    };
    const tools = createBrowserTools(makeManager(page));
    const extract = tools.find((t) => t.name === 'browser_extract_links')!;
    const result = await extract.execute({ selector: 'nav' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      links: [{ text: 'Home', href: 'https://x.test/' }],
    });
  });
});
