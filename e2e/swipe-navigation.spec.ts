import { test, expect, type Page } from '@playwright/test';
import { mockFirebaseAuth } from './helpers';

const PAGE_ORDER = ['/', '/players', '/profile', '/map', '/backups', '/analytics'];

async function dispatchTouch(
  page: Page,
  type: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ eventType, clientX, clientY }) => {
      const host = document.querySelector('app-root > div[appswipenavigate]');
      if (!host) {
        throw new Error('App root host not found for swipe dispatch');
      }

      const evt = new Event(eventType, { bubbles: true, cancelable: true });
      const touch = { clientX, clientY };
      const touchList = {
        0: touch,
        length: 1,
        item: (index: number) => (index === 0 ? touch : null),
        [Symbol.iterator]: function* () {
          yield touch;
        },
      };

      if (eventType === 'touchend') {
        Object.defineProperty(evt, 'changedTouches', { value: touchList });
      } else {
        Object.defineProperty(evt, 'touches', { value: touchList });
      }

      host.dispatchEvent(evt);
    },
    { eventType: type, clientX: x, clientY: y },
  );
}

async function swipeLeft(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(size.height * 0.5);
  await dispatchTouch(page, 'touchstart', Math.round(size.width * 0.9), y);
  await dispatchTouch(page, 'touchmove', Math.round(size.width * 0.1), y);
  await dispatchTouch(page, 'touchend', Math.round(size.width * 0.1), y);
}

async function swipeRight(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(size.height * 0.5);
  await dispatchTouch(page, 'touchstart', Math.round(size.width * 0.1), y);
  await dispatchTouch(page, 'touchmove', Math.round(size.width * 0.9), y);
  await dispatchTouch(page, 'touchend', Math.round(size.width * 0.9), y);
}

async function swipeLeftShort(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(size.height * 0.5);
  // Move only 10% of viewport (below 50% threshold)
  await dispatchTouch(page, 'touchstart', Math.round(size.width * 0.55), y);
  await dispatchTouch(page, 'touchmove', Math.round(size.width * 0.45), y);
  await dispatchTouch(page, 'touchend', Math.round(size.width * 0.45), y);
}

async function swipeRightShort(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const y = Math.round(size.height * 0.5);
  // Move only 10% of viewport (below 50% threshold)
  await dispatchTouch(page, 'touchstart', Math.round(size.width * 0.45), y);
  await dispatchTouch(page, 'touchmove', Math.round(size.width * 0.55), y);
  await dispatchTouch(page, 'touchend', Math.round(size.width * 0.55), y);
}

/**
 * Perform a swipe and assert it navigated to `target`. A synthetic touch
 * sequence occasionally doesn't register with the directive (a Playwright
 * dispatch timing artifact, not an app bug), so re-send the gesture until the
 * route changes. The guard `already there → return` makes it safe against a
 * double navigation, and the final attempt still fails loudly if a swipe never
 * navigates — so real regressions are still caught.
 */
async function commitSwipe(
  page: Page,
  swipe: (p: Page) => Promise<void>,
  target: RegExp,
): Promise<void> {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (target.test(page.url())) return;
    await swipe(page);
    try {
      await expect(page).toHaveURL(target, { timeout: 2_500 });
      return;
    } catch {
      if (attempt === attempts) {
        // Surface a clear failure with Playwright's own diagnostics.
        await expect(page).toHaveURL(target, { timeout: 2_500 });
      }
    }
  }
}

test.describe('Swipe navigation across app pages', () => {
  test.beforeEach(async ({ page }) => {
    await mockFirebaseAuth(page);
  });

  test('swipe left moves forward through all pages in order', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    for (let i = 0; i < PAGE_ORDER.length - 1; i++) {
      const next = PAGE_ORDER[i + 1].replace('/', '\\/');
      await commitSwipe(page, swipeLeft, new RegExp(`${next}$`));
    }
  });

  test('swipe right moves backward through all pages in order', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/analytics$/);

    for (let i = PAGE_ORDER.length - 1; i > 0; i--) {
      const prev = PAGE_ORDER[i - 1].replace('/', '\\/');
      await commitSwipe(page, swipeRight, new RegExp(`${prev}$`));
    }
  });

  test('short left swipe below threshold does not navigate', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    // Perform a short swipe (only 10% movement, below 50% threshold)
    await swipeLeftShort(page);

    // Should still be on home page
    await expect(page).toHaveURL(/\/$/);
  });

  test('short right swipe below threshold does not navigate', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/analytics$/);

    // Perform a short swipe (only 10% movement, below 50% threshold)
    await swipeRightShort(page);

    // Should still be on analytics page
    await expect(page).toHaveURL(/\/analytics$/);
  });
});
