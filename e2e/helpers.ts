/**
 * Shared utilities for Playwright e2e tests.
 *
 * Firebase authentication is required for most routes.  Tests that cover
 * authenticated pages call `mockFirebaseAuth` before navigating so that
 * Angular's AuthService immediately fulfils the isLoading=false / currentUser
 * check without contacting real Firebase infrastructure.
 */

import { Page } from '@playwright/test';

/** A minimal Firebase user object accepted by the auth guard. */
export const MOCK_USER = {
  uid: 'playwright-test-uid',
  email: 'test@minecraft.local',
  displayName: 'Playwright Tester',
  photoURL: null,
};

/**
 * Injects a mocked Firebase auth state before the Angular app boots.
 * Must be called BEFORE `page.goto()`.
 *
 * Strategy:
 *  1. We override `onAuthStateChanged` on the firebase/auth namespace with a
 *     shim that immediately calls the supplied callback with MOCK_USER.
 *  2. `getAuth` returns a lightweight stub so Angular's AuthService can reach
 *     the shim without starting a real Firebase connection.
 */
export async function mockFirebaseAuth(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    if (sessionStorage.getItem('__E2E_FORCE_SIGNED_OUT__') === '1') {
      return;
    }

    // Consumed by AuthService in dev mode to bypass Firebase restore during e2e.
    (globalThis as Record<string, unknown>)['__E2E_AUTH_USER__'] = user;

    // Consumed by UserProfileService to skip Firestore calls and return a
    // pre-linked profile so the auth guard's Minecraft account check passes.
    (globalThis as Record<string, unknown>)['__E2E_PROFILE__'] = {
      minecraftAccounts: { java: 'TestPlayer', bedrock: null, admin: null },
      savedLocations: [],
      savedHomes: [],
    };

    // @ts-expect-error – runtime patch before module loading
    window.__PLAYWRIGHT_MOCK_USER__ = user;

    // Patch globalThis so dynamic imports that reach firebase/auth get a stub.
    const originalDefineProperty = Object.defineProperty.bind(Object);
    const shimModule = {
      getAuth: () => ({ currentUser: user }),
      onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
        // Trigger immediately so isLoading resolves on the first tick.
        setTimeout(() => cb(user), 0);
        return () => {};           // unsubscribe noop
      },
      signInWithPopup: () => Promise.resolve({ user }),
      signOut: () => Promise.resolve(),
      GoogleAuthProvider: class {},
    };

    // ESM interop: make window.__firebaseAuthShim available for any scripts
    // that try to import from firebase/auth's bundle.
    (window as Record<string, unknown>)['__firebaseAuthShim__'] = shimModule;
  }, MOCK_USER);

  // Intercept all Firebase Auth REST calls and return a valid logged-in response.
  await page.route('**/identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ idToken: 'mock-id-token', localId: MOCK_USER.uid }),
    }),
  );

  // Intercept all backend /api/ calls so tests don't need a live Python server.
  await page.route('**/api/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        online: true,
        version: 'Paper 1.21.4',
        players: { online: 2, max: 20 },
        motd: { clean: ['A Minecraft Server'] },
      }),
    }),
  );

  await page.route('**/api/bedrock-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ online: false }),
    }),
  );

  await page.route('**/api/players', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { name: 'Steve', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', level: 30, gameMode: 'survival' },
        { name: 'Alex',  uuid: 'ec561538-f3fd-461d-aff5-086b22154bce', level: 25, gameMode: 'survival' },
      ]),
    }),
  );

  await page.route('**/api/analytics**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        points: [
          { t: Math.floor(Date.now() / 1000) - 3600, avg: 1, peak: 1 },
          { t: Math.floor(Date.now() / 1000) - 1800, avg: 2, peak: 2 },
        ],
        summary: { peak: 2, avg: 2 },
      }),
    }),
  );

  await page.route('**/api/backups**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'file-001',
          name: 'backup-2025-01-01.zip',
          mimeType: 'application/zip',
          createdTime: '2025-01-01T00:00:00.000Z',
          size: '10485760',
        },
      ]),
    }),
  );
}

/**
 * Resolves AuthService's isLoading immediately with no user, without
 * contacting Firebase. Use this in login-page and auth-redirect tests
 * where the browser should behave as if no user is signed in.
 *
 * Must be called BEFORE `page.goto()`.
 */
export async function mockFirebaseUnauthenticated(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>)['__E2E_UNAUTHENTICATED__'] = true;
  });

  // IMPORTANT: use fulfill (not abort) for Firebase/Google API calls.
  // Aborting causes the Firebase SDK to hang waiting for its initialisation
  // requests, which in turn prevents onAuthStateChanged from ever firing.
  // A fast error response lets the SDK fail quickly and resolve auth state.
  await page.route('**/identitytoolkit.googleapis.com/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/securetoken.googleapis.com/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/firebase.googleapis.com/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/firebaseapp.com/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );
}
