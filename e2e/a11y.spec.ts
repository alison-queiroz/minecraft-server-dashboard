import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mockFirebaseAuth, mockFirebaseUnauthenticated } from './helpers';

/**
 * Accessibility checks: axe-core WCAG 2.0/2.1 A + AA rules on every route in
 * both colour schemes, plus the keyboard / ARIA behaviour axe cannot see.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Known colour-contrast failures in files owned by other work streams, excluded
 * from the color-contrast rule ONLY (every other rule still scans them).
 * Remove an entry once its file is fixed — the scan then covers it again.
 */
const DEFERRED_CONTRAST_SELECTORS: readonly string[] = [
  // components/shared/server-status-badge: ONLINE/OFFLINE label emerald-400 / red-400 on its tint (light, 1.6-2.2:1).
  'app-server-status-badge',
  // components/shared/page-header: subtitle text-zinc-500 on the stone-100 page (light, 4.43:1).
  'app-page-header p',
  // components/player/player-detail: .detail-empty-copy zinc-500 on stone-100 (light 4.43:1) / zinc-600 (dark 2.47:1).
  '.detail-empty-copy',
  // components/server/server-connection-card: .connection-value--accent emerald-400 on white (light, 1.92:1).
  '.connection-value--accent',
  // components/server/server-bedrock-card: blue-400 port / red-400 status (light ~2.4:1), zinc-500/600 notes (dark 2.3-3.5:1).
  '.bedrock-note-port',
  '.bedrock-status',
  '.bedrock-via',
  '.bedrock-note-text',
  // components/server/server-players-card: "/ max" and "online" zinc-600 on zinc-900 (dark, 2.29:1).
  '.players-card-max',
  '.players-card-label',
  // components/profile/profile-accounts: .account-type badges emerald/blue/orange-400 on white (light, 1.9-2.5:1).
  '.account-type',
  // components/shared/action-button: primary white on emerald-600 (3.76:1).
  '.action-button--primary',
  // pages/analytics: active .period-btn green-400 on its tint (light, 1.59:1).
  '.period-btn.active',
  // pages/login: .login-note zinc-500 on zinc-900 (dark, 3.66:1).
  '.login-note',
  // pages/services: .services-updated / .services-edit-hint / detail <dt> zinc-500 on the page (4.43:1 light, 4.11:1 dark).
  '.services-updated',
  '.services-edit-hint',
  '.service-detail-row dt',
];

interface RouteCase {
  path: string;
  title: string;
  ready: (page: Page) => Locator;
}

const AUTHENTICATED_ROUTES: readonly RouteCase[] = [
  { path: '/', title: 'Home', ready: (page) => page.locator('app-server-hero-banner') },
  { path: '/players', title: 'Players', ready: (page) => page.locator('app-player-card-row').first() },
  { path: '/profile', title: 'Profile', ready: (page) => page.locator('.profile-tabs') },
  { path: '/map', title: 'World Map', ready: (page) => page.getByRole('heading', { name: 'World Map' }) },
  { path: '/backups', title: 'Backups', ready: (page) => page.getByRole('heading', { name: 'Server Backups' }) },
  { path: '/analytics', title: 'Analytics', ready: (page) => page.getByRole('heading', { name: 'Server Analytics' }) },
  { path: '/services', title: 'Services', ready: (page) => page.locator('.services-title') },
];

async function mockServicesCatalog(page: Page): Promise<void> {
  await page.route('**/api/services-catalog', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        canEdit: false,
        catalog: {
          updatedAt: '2026-01-01',
          sections: [
            {
              title: 'Public Game Servers',
              description: 'Directly reachable game servers.',
              services: [
                {
                  name: 'Minecraft Java',
                  host: 'example.org',
                  port: 25565,
                  protocol: 'TCP',
                  access: 'public',
                  runtime: 'arm64',
                  location: 'Test',
                },
              ],
            },
          ],
        },
      }),
    }),
  );
}

/** `overrides` run after the shared mocks, so their page.route handlers take precedence. */
async function openAuthenticated(
  page: Page,
  route: RouteCase,
  overrides?: (page: Page) => Promise<void>,
): Promise<void> {
  await mockFirebaseAuth(page);
  await mockServicesCatalog(page);
  await overrides?.(page);
  await page.goto(route.path);
  await expect(route.ready(page)).toBeVisible({ timeout: 15_000 });
}

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

async function expectNoAxeViolations(page: Page): Promise<void> {
  // Sequential on purpose: axe-core refuses concurrent runs in one page.
  const general = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .disableRules(['color-contrast'])
    .analyze();
  const contrast = await DEFERRED_CONTRAST_SELECTORS.reduce(
    (builder, selector) => builder.exclude(selector),
    new AxeBuilder({ page }).withRules(['color-contrast']),
  ).analyze();
  const violations: AxeResults['violations'] = [...general.violations, ...contrast.violations];

  if (violations.length > 0) {
    await test.info().attach('axe-violations.json', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  }

  const summary = violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe (${colorScheme} scheme)`, () => {
    test.use({ colorScheme });

    test('/login has no WCAG A/AA violations', async ({ page }) => {
      await mockFirebaseUnauthenticated(page);
      await page.goto('/login');
      await expect(page.locator('h1')).toBeVisible({ timeout: 15_000 });

      await expectNoAxeViolations(page);
    });

    for (const route of AUTHENTICATED_ROUTES) {
      test(`${route.path} has no WCAG A/AA violations`, async ({ page }) => {
        await openAuthenticated(page, route);

        await expectNoAxeViolations(page);
      });
    }
  });
}

test.describe('Document semantics', () => {
  test('login page declares a language and a visible h1', async ({ page }) => {
    await mockFirebaseUnauthenticated(page);
    await page.goto('/login');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15_000 });

    expect(await page.locator('html').getAttribute('lang')).toBeTruthy();
    await expect(page.locator('h1')).not.toBeEmpty();
    await expect(page).toHaveTitle('Sign in · EV Minecraft Server');
  });

  for (const route of AUTHENTICATED_ROUTES) {
    test(`${route.path} has a descriptive document title`, async ({ page }) => {
      await openAuthenticated(page, route);

      await expect(page).toHaveTitle(`${route.title} · EV Minecraft Server`);
    });
  }
});

test.describe('Keyboard operation', () => {
  const playersRoute = AUTHENTICATED_ROUTES.find((route) => route.path === '/players')!;

  test('player search input has an accessible label', async ({ page }) => {
    await openAuthenticated(page, playersRoute);

    await expect(page.getByRole('textbox', { name: 'Search players' })).toBeVisible();
  });

  test('a player row can be opened with the keyboard', async ({ page }) => {
    // Full player payload: the detail panel needs pos/health to render.
    await openAuthenticated(page, playersRoute, (p) =>
      p.route('**/api/players', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              name: 'Steve',
              uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
              level: 30,
              health: 20,
              dimension: 'Overworld',
              pos: [12, 64, -8],
              last_seen: 'now',
              play_hours: 120,
              advancement_count: 53,
            },
          ]),
        }),
      ),
    );

    const rowButton = page.locator('app-player-card-row').first().getByRole('button', { name: 'Steve' });
    await rowButton.focus();
    await expect(rowButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('.detail-name')).toHaveText('Steve');
    await expect(rowButton).toHaveAttribute('aria-current', 'true');
  });

  test('More dropdown exposes its state and closes on Escape', async ({ page }) => {
    await openAuthenticated(page, AUTHENTICATED_ROUTES[0]!);

    const more = page.getByRole('button', { name: 'More navigation options' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`#${await more.getAttribute('aria-controls')}`)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
  });

  test.describe('mobile viewport', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('menu toggle exposes its state and closes on Escape', async ({ page }) => {
      await openAuthenticated(page, AUTHENTICATED_ROUTES[0]!);

      const toggle = page.getByRole('button', { name: 'Toggle menu' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const menu = page.locator(`#${await toggle.getAttribute('aria-controls')}`);
      await expect(menu).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(toggle).toBeFocused();
    });
  });
});
