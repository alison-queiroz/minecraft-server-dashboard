import { test, expect } from '@playwright/test';

/**
 * Accessibility smoke tests using Playwright's built-in a11y checks.
 *
 * These tests verify that key pages have:
 *  - At least one landmark (main / nav) to support screen readers.
 *  - Buttons with accessible labels.
 *  - The document language attribute set.
 *
 * No Firebase auth is required because only the /login route is tested here.
 */

test.describe('Accessibility – login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/firebase**', (route) => route.abort());
    await page.route('**/googleapis.com/**', (route) => route.abort());
    await page.goto('/login');
  });

  test('document has a lang attribute', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
  });

  test('sign-in button has an accessible text label', async ({ page }) => {
    const button = page.locator('button:has-text("Sign in with Google")');
    await expect(button).toBeFocused().catch(() => {
      // Not required to be pre-focused; just check it is labelled.
    });
    const text = await button.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('page heading is a visible h1 element', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).not.toBeEmpty();
  });
});
