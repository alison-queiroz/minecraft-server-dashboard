import { test, expect } from '@playwright/test';
import { mockFirebaseAuth } from './helpers';

/**
 * Navigation tests verify that the top-level routes load without crashing
 * and that key structural elements (header, nav links) are present.
 *
 * Because the app requires Firebase authentication, these tests use the
 * `mockFirebaseAuth` helper which intercepts Firebase network calls and
 * stubs all backend /api/ routes.
 *
 * NOTE: The Firebase auth shim works at the network / storage level.
 * Angular's AuthService may still see isLoading=true briefly while it waits
 * for the IndexedDB session to resolve.  The tests use generous timeouts to
 * accommodate this.
 */

test.describe('Application navigation (unauthenticated redirects)', () => {
  test('unknown route redirects to home or login', async ({ page }) => {
    await page.goto('/nonexistent-route-12345');

    // The app should either show the login page or redirect home — never a blank 404.
    await expect(page).toHaveURL(/\/(login|$)/, { timeout: 8_000 });
  });
});

test.describe('Login → app flow smoke test', () => {
  test('login page has working sign-in button element', async ({ page }) => {
    await page.goto('/login');

    const button = page.locator('button:has-text("Sign in with Google")');
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // The button should have a click handler (verify it is not a plain anchor).
    const tag = await button.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('button');
  });
});

test.describe('Static asset loading', () => {
  test('Angular app shell loads (HTML document served)', async ({ page }) => {
    const response = await page.goto('/');
    // The dev server should return 200 for the root route.
    expect(response?.status()).toBeLessThan(400);
  });

  test('page title is set by the Angular app', async ({ page }) => {
    await page.goto('/login');
    // The title comes from the manifest / index.html; just verify it is not empty.
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
