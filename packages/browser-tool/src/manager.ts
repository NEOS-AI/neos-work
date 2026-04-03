// packages/browser-tool/src/manager.ts
import { chromium, type Browser, type Page } from 'playwright';

/**
 * 세션 스코프 Playwright 브라우저 관리자.
 * 세션당 하나의 Chromium 인스턴스와 Page를 재사용한다.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async connect(): Promise<void> {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
  }

  async disconnect(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error('BrowserManager not connected. Call connect() first.');
    }
    return this.page;
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}
