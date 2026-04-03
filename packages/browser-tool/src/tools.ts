// packages/browser-tool/src/tools.ts
import type { Tool } from '@neos-work/core';
import type { BrowserManager } from './manager.js';

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
        const { url } = input as { url: string };
        const page = manager.getPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return { success: true, output: { title: await page.title(), url: page.url() } };
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
        const { selector } = input as { selector: string };
        const page = manager.getPage();
        await page.click(selector, { timeout: 10_000 });
        return { success: true, output: { success: true } };
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
        const { selector, value } = input as { selector: string; value: string };
        const page = manager.getPage();
        await page.fill(selector, value, { timeout: 10_000 });
        return { success: true, output: { success: true } };
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
        const { fullPage = false } = input as { fullPage?: boolean };
        const page = manager.getPage();
        const buffer = await page.screenshot({ fullPage });
        return { success: true, output: { screenshot: buffer.toString('base64') } };
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
        const { selector } = input as { selector?: string };
        const page = manager.getPage();
        const text = selector
          ? await page.locator(selector).innerText({ timeout: 10_000 })
          : await page.evaluate(() => document.body.innerText);
        return { success: true, output: { text } };
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
        const { selector } = input as { selector?: string };
        const page = manager.getPage();
        const links = await page.evaluate((sel: string | null) => {
          const container: Element | Document = sel
            ? (document.querySelector(sel) ?? document)
            : document;
          return Array.from(container.querySelectorAll('a[href]')).map((a) => ({
            text: (a as HTMLAnchorElement).innerText.trim(),
            href: (a as HTMLAnchorElement).href,
          }));
        }, selector ?? null);
        return { success: true, output: { links } };
      },
    },
  ];
}
