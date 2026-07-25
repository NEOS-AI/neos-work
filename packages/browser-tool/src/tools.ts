// packages/browser-tool/src/tools.ts
import type { Tool, ToolResult } from '@neos-work/core';
import type { BrowserManager } from './manager.js';

/** Cap browser navigation URLs (defense against pathological query strings). */
const BROWSER_URL_MAX_CHARS = 2_048;

/**
 * Only http(s) navigation — blocks file:/javascript:/data: style SSRF vectors.
 */
export function isSafeBrowserUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return null;
  const s = raw.trim();
  if (!s || s.length > BROWSER_URL_MAX_CHARS) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return s;
  } catch {
    return null;
  }
}

function trimSelector(raw: unknown): string {
  const sRaw = typeof raw === 'string' ? raw : String(raw ?? '');
  // Cap CSS selector length; reject control chars before trim
  if (!sRaw || /[\0\r\n]/.test(sRaw)) return '';
  const s = sRaw.trim();
  if (!s || s.length > 1_000) return '';
  return s;
}

/** Cap browser fill values / extracted text (runaway DOM defense). */
const BROWSER_FILL_MAX_CHARS = 100_000;
const BROWSER_TEXT_MAX_CHARS = 500_000;
const BROWSER_LINKS_MAX = 500;
const BROWSER_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;

function toolFailure(err: unknown, fallback: string): ToolResult {
  return {
    success: false,
    output: null,
    error: err instanceof Error ? err.message : fallback,
  };
}

/**
 * BrowserManager 인스턴스를 받아 6개 브라우저 Tool을 반환한다.
 * Tool 인터페이스: { name, description, inputSchema, execute(input) }
 */
export function createBrowserTools(manager: BrowserManager): Tool[] {
  return [
    {
      name: 'browser_navigate',
      description: '지정한 URL로 웹 페이지를 탐색합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '이동할 URL (http:// 또는 https:// 포함)' },
        },
        required: ['url'],
      },
      async execute(input) {
        try {
          const url = isSafeBrowserUrl((input as { url?: unknown }).url);
          if (!url) {
            return {
              success: false,
              output: null,
              error: 'URL must be a valid http(s) URL',
            };
          }
          const page = manager.getPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          return { success: true, output: { title: await page.title(), url: page.url() } };
        } catch (err) {
          return toolFailure(err, 'browser_navigate failed');
        }
      },
    },
    {
      name: 'browser_click',
      description: 'CSS 셀렉터에 해당하는 요소를 클릭합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS 셀렉터' },
        },
        required: ['selector'],
      },
      async execute(input) {
        try {
          const selector = trimSelector((input as { selector?: unknown }).selector);
          if (!selector) {
            return { success: false, output: null, error: 'selector is required' };
          }
          const page = manager.getPage();
          await page.click(selector, { timeout: 10_000 });
          return { success: true, output: { success: true } };
        } catch (err) {
          return toolFailure(err, 'browser_click failed');
        }
      },
    },
    {
      name: 'browser_fill',
      description: '폼 필드에 텍스트를 입력합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS 셀렉터' },
          value: { type: 'string', description: '입력할 값' },
        },
        required: ['selector', 'value'],
      },
      async execute(input) {
        try {
          const selector = trimSelector((input as { selector?: unknown }).selector);
          if (!selector) {
            return { success: false, output: null, error: 'selector is required' };
          }
          const valueRaw = (input as { value?: unknown }).value;
          let value = typeof valueRaw === 'string' ? valueRaw : String(valueRaw ?? '');
          if (value.length > BROWSER_FILL_MAX_CHARS) {
            return {
              success: false,
              output: null,
              error: `value exceeds max size (${BROWSER_FILL_MAX_CHARS} characters)`,
            };
          }
          const page = manager.getPage();
          await page.fill(selector, value, { timeout: 10_000 });
          return { success: true, output: { success: true } };
        } catch (err) {
          return toolFailure(err, 'browser_fill failed');
        }
      },
    },
    {
      name: 'browser_screenshot',
      description: '현재 페이지의 스크린샷을 base64 PNG로 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          fullPage: {
            type: 'boolean',
            description: '전체 페이지 스크린샷 여부 (기본: false)',
          },
        },
      },
      async execute(input) {
        try {
          const { fullPage = false } = input as { fullPage?: boolean };
          const page = manager.getPage();
          const buffer = await page.screenshot({ fullPage: Boolean(fullPage) });
          if (buffer.byteLength > BROWSER_SCREENSHOT_MAX_BYTES) {
            return {
              success: false,
              output: null,
              error: `Screenshot exceeds max size (${BROWSER_SCREENSHOT_MAX_BYTES} bytes)`,
            };
          }
          return { success: true, output: { screenshot: buffer.toString('base64') } };
        } catch (err) {
          return toolFailure(err, 'browser_screenshot failed');
        }
      },
    },
    {
      name: 'browser_extract_text',
      description: '페이지 전체 또는 특정 요소의 텍스트를 추출합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 셀렉터 (생략 시 body 전체)',
          },
        },
      },
      async execute(input) {
        try {
          const selector = trimSelector((input as { selector?: unknown }).selector);
          const page = manager.getPage();
          let text = selector
            ? await page.locator(selector).innerText({ timeout: 10_000 })
            : await page.evaluate(() => document.body.innerText);
          if (typeof text !== 'string') text = String(text ?? '');
          if (text.length > BROWSER_TEXT_MAX_CHARS) {
            text = text.slice(0, BROWSER_TEXT_MAX_CHARS) + '\n…[text truncated]';
          }
          return { success: true, output: { text } };
        } catch (err) {
          return toolFailure(err, 'browser_extract_text failed');
        }
      },
    },
    {
      name: 'browser_extract_links',
      description: '페이지 또는 특정 영역의 링크(텍스트 + href) 목록을 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 셀렉터 (생략 시 전체 페이지)',
          },
        },
      },
      async execute(input) {
        try {
          const selector = trimSelector((input as { selector?: unknown }).selector);
          const page = manager.getPage();
          const links = await page.evaluate((sel: string | null) => {
            const container: Element | Document = sel
              ? (document.querySelector(sel) ?? document)
              : document;
            return Array.from(container.querySelectorAll('a[href]')).map((a) => ({
              text: (a as HTMLAnchorElement).innerText.trim(),
              href: (a as HTMLAnchorElement).href,
            }));
          }, selector || null);
          // Sanitize evaluate results: control-char text/href dropped; only http(s)
          const sanitized = (Array.isArray(links) ? links : [])
            .slice(0, BROWSER_LINKS_MAX)
            .map((l) => {
              const href = isSafeBrowserUrl(
                typeof l?.href === 'string' ? l.href : '',
              );
              if (!href) return null;
              let text = '';
              if (typeof l?.text === 'string' && !/[\0\r\n]/.test(l.text)) {
                text = l.text.trim().slice(0, 500);
              }
              return { text, href };
            })
            .filter((l): l is { text: string; href: string } => l != null);
          return { success: true, output: { links: sanitized } };
        } catch (err) {
          return toolFailure(err, 'browser_extract_links failed');
        }
      },
    },
  ];
}
