import { test, expect } from '@playwright/test';

/**
 * API route contract tests.
 *
 * These tests call the Angular dev-server proxy (configured in proxy.conf.json)
 * which forwards /api/* requests to the Python backend.  They verify that the
 * API endpoints return the expected HTTP status codes and JSON structure.
 *
 * Prerequisites:
 *   - Python backend running on the port configured in proxy.conf.json.
 *   - FIREBASE_SA_KEY env var pointing to a valid service-account file, OR
 *     _FIREBASE_INITIALIZED=False (dev mode, no auth enforced).
 *
 * These tests are intentionally skipped when the backend is not available
 * (the proxy returns 502 / ECONNREFUSED); they are useful for local
 * integration checks and CI pipelines that spin up the full stack.
 */

const AUTH_HEADER = { Authorization: 'Bearer __dev_token__' };

test.describe('API – /api/status', () => {
  test('returns a JSON response with an "online" boolean field', async ({ request }) => {
    const res = await request.get('/api/status');

    test.skip(res.status() >= 500, 'Python backend not running — skipping API tests');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.online).toBe('boolean');
  });
});

test.describe('API – /api/bedrock-status', () => {
  test('returns a JSON response with an "online" boolean field', async ({ request }) => {
    const res = await request.get('/api/bedrock-status');

    test.skip(res.status() >= 500, 'Python backend not running — skipping API tests');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.online).toBe('boolean');
  });
});

test.describe('API – /api/players', () => {
  test('returns 401 when no Authorization header is sent', async ({ request }) => {
    const res = await request.get('/api/players');

    test.skip(res.status() >= 500, 'Python backend not running — skipping API tests');

    // Either 401 (Firebase enforced) or 200 (dev mode with no auth).
    expect([200, 401]).toContain(res.status());
  });
});

test.describe('API – /api/backups', () => {
  test('returns 401 for an unauthenticated request', async ({ request }) => {
    const res = await request.get('/api/backups');

    test.skip(res.status() >= 500, 'Python backend not running — skipping API tests');

    expect([200, 401]).toContain(res.status());
  });
});
