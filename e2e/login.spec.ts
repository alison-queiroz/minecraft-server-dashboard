import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    // Prevent actual Firebase connections during tests.
    await page.route('**/firebase**', (route) => route.abort());
    await page.route('**/googleapis.com/**', (route) => route.abort());
  });

  test('renders the page title and sign-in button', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('h1')).toContainText('Minecraft Dashboard');
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toContainText('Sign in with Google');
  });

  test('displays the subtitle describing who can access the dashboard', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('p.login-subtitle')).toContainText(
      'Sign in to access the server dashboard',
    );
  });

  test('sign-in button is initially enabled', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  });

  test('shows the Google logo SVG inside the sign-in button', async ({ page }) => {
    await page.goto('/login');

    // The login button contains an inline SVG Google logo
    await expect(page.locator('button svg.login-google-icon')).toBeVisible();
  });

  test('displays the restricted-access note', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('p.login-note')).toContainText('authorised Google accounts');
  });
});

test.describe('Auth redirect', () => {
  test.beforeEach(async ({ page }) => {
    // Abort Firebase so isLoading stays true briefly, then resolves with no user.
    await page.route('**/firebase**', (route) => route.abort());
    await page.route('**/googleapis.com/**', (route) => route.abort());
  });

  test('redirects unauthenticated users from / to /login', async ({ page }) => {
    await page.goto('/');

    // The auth guard resolves once isLoading=false; without a real Firebase
    // session the user is null → redirected to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects unauthenticated users from /server to /login', async ({ page }) => {
    await page.goto('/server');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects unauthenticated users from /players to /login', async ({ page }) => {
    await page.goto('/players');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
