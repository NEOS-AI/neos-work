/**
 * Web Design Project golden path (v0.15 M2 / T3 browser E2E).
 *
 * Connect → create project → seed index.html → edit Code → Save → Preview.
 */
import { expect, test } from '@playwright/test';

const token = () =>
  process.env.NEOS_BROWSER_TOKEN
  || process.env.NEOS_AUTH_TOKEN
  || '';

const serverBase = () =>
  `http://127.0.0.1:${process.env.NEOS_BROWSER_SERVER_PORT || '14110'}`;

const MARKER = 'browser-e2e-ok';

test.describe('Design Project browser loop', () => {
  test('connect → create → edit → save → preview', async ({ page, request }) => {
    const auth = token();
    expect(auth.length, 'NEOS_AUTH_TOKEN / NEOS_BROWSER_TOKEN must be set').toBeGreaterThan(15);

    // 1. Connect
    await page.goto('/');
    await expect(page.getByTestId('connect-submit')).toBeVisible();

    // Default URL is Vite origin (proxy). Set explicitly for clarity.
    await page.getByTestId('connect-url').fill(page.url().replace(/\/$/, '') || 'http://127.0.0.1:5174');
    await page.getByTestId('connect-token').fill(auth);
    await page.getByTestId('connect-submit').click();

    await expect(page).toHaveURL(/\/projects\/?$/, { timeout: 20_000 });
    await expect(page.getByTestId('project-create-form')).toBeVisible();

    // 2. Create project
    const projectName = `browser-e2e-${Date.now()}`;
    await page.getByTestId('project-create-name').fill(projectName);
    await page.getByTestId('project-create-submit').click();

    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/i, { timeout: 20_000 });
    await expect(page.getByTestId('project-workspace')).toBeVisible();

    const projectId = page.url().match(/\/projects\/([^/?#]+)/)?.[1];
    expect(projectId).toBeTruthy();

    // 3. Seed entry file via API (web UI has no “new file” yet)
    const seedHtml =
      `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>`
      + `<body><main id="hero">seed</main></body></html>`;
    const put = await request.put(
      `${serverBase()}/api/projects/${encodeURIComponent(projectId!)}/files/index.html`,
      {
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
        },
        data: { content: seedHtml, source: 'user' },
      },
    );
    expect(put.ok(), `seed write failed: ${put.status()} ${await put.text()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await page.getByTestId('file-index.html').click();
    await expect(page.getByTestId('design-editor')).toBeVisible({ timeout: 15_000 });

    // 4. Code edit + save
    await page.getByTestId('mode-code').click();
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible();
    await cm.click();
    await page.keyboard.press('ControlOrMeta+A');
    const edited =
      `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>`
      + `<body><main id="hero">${MARKER}</main></body></html>`;
    await page.keyboard.insertText(edited);

    // Both host (web-dirty) and DesignEditor (dirty-badge) may show Unsaved
    await expect(page.getByTestId('web-dirty')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('web-dirty')).toHaveCount(0, { timeout: 15_000 });
    // No error alert on the workspace (role=alert is used for errors only)
    await expect(page.locator('[data-testid="project-workspace"] [role="alert"]')).toHaveCount(0);

    // 5. Preview shows marker
    await page.getByTestId('mode-preview').click();
    const frame = page.frameLocator('[data-testid="preview-frame"]');
    await expect(frame.locator('#hero')).toHaveText(MARKER, { timeout: 15_000 });
  });
});
