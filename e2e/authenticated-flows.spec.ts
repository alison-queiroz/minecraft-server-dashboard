import { test, expect } from '@playwright/test';
import { mockFirebaseAuth } from './helpers';

async function expectNotOnLogin(pageUrl: string, actualUrl: string): Promise<void> {
  if (actualUrl.includes('/login')) {
    throw new Error(`Expected authenticated access to ${pageUrl}, but app redirected to /login`);
  }
}

test.describe('Authenticated post-login flows', () => {
  test.beforeEach(async ({ page }) => {
    await mockFirebaseAuth(page);
  });

  test('opens home page as authenticated user', async ({ page }) => {
    await page.goto('/');
    await expectNotOnLogin('/', page.url());

    await expect(page.locator('app-nav')).toBeVisible();
    await expect(page.locator('app-server-hero-card')).toBeVisible();
  });

  test('opens server status page', async ({ page }) => {
    await page.goto('/server');
    await expectNotOnLogin('/server', page.url());

    await expect(page.getByRole('heading', { name: 'Server Status' })).toBeVisible();
  });

  test('opens players page', async ({ page }) => {
    await page.goto('/players');
    await expectNotOnLogin('/players', page.url());

    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();
  });

  test('opens profile page', async ({ page }) => {
    await page.goto('/profile');
    await expectNotOnLogin('/profile', page.url());

    await expect(page.locator('.profile-tabs')).toBeVisible();
    await expect(page.locator('.profile-email')).toContainText('test@minecraft.local');
  });

  test('opens map page', async ({ page }) => {
    await page.goto('/map');
    await expectNotOnLogin('/map', page.url());

    await expect(page.getByRole('heading', { name: 'World Map' })).toBeVisible();
  });

  test('opens backups page', async ({ page }) => {
    await page.goto('/backups');
    await expectNotOnLogin('/backups', page.url());

    await expect(page.getByRole('heading', { name: 'Server Backups' })).toBeVisible();
  });

  test('opens analytics page', async ({ page }) => {
    await page.goto('/analytics');
    await expectNotOnLogin('/analytics', page.url());

    await expect(page.getByRole('heading', { name: 'Server Analytics' })).toBeVisible();
  });

  test('can navigate between protected routes from desktop nav', async ({ page }) => {
    await page.goto('/');
    await expectNotOnLogin('/', page.url());

    const nav = page.locator('app-nav');

    await nav.getByRole('link', { name: 'Players', exact: true }).first().click();
    await expect(page).toHaveURL(/\/players/);

    await nav.getByRole('link', { name: 'Profile', exact: true }).first().click();
    await expect(page).toHaveURL(/\/profile/);

    await nav.getByRole('link', { name: 'Analytics', exact: true }).first().click();
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('sign out redirects to login and protected routes require auth again', async ({ page }) => {
    await page.goto('/profile');
    await expectNotOnLogin('/profile', page.url());

    await page.locator('app-nav .signout-button').first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
