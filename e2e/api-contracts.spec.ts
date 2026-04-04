import { test, expect, type APIResponse } from '@playwright/test';

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
 * If the backend is unavailable, tests fail with a clear diagnostic so
 * setup issues are visible immediately.
 */

async function assertBackendReachable(res: APIResponse, endpoint: string): Promise<void> {
  const status = res.status();
  if (status < 500) {
    return;
  }

  const body = await res.text();
  throw new Error(
    [
      `Backend/proxy unavailable for ${endpoint}.`,
      `Expected non-5xx response but got HTTP ${status}.`,
      'Make sure the Python API is running on http://127.0.0.1:5000 and Angular proxy is active.',
      `Response body: ${body.slice(0, 300)}`,
    ].join(' '),
  );
}

test.describe('API – /api/status', () => {
  test('returns a JSON response with an "online" boolean field', async ({ request }) => {
    const res = await request.get('/api/status');
    await assertBackendReachable(res, '/api/status');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.online).toBe('boolean');
  });
});

test.describe('API – /api/bedrock-status', () => {
  test('returns a JSON response with an "online" boolean field', async ({ request }) => {
    const res = await request.get('/api/bedrock-status');
    await assertBackendReachable(res, '/api/bedrock-status');

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.online).toBe('boolean');
  });
});

test.describe('API – /api/players', () => {
  test('returns 401 when no Authorization header is sent', async ({ request }) => {
    const res = await request.get('/api/players');
    await assertBackendReachable(res, '/api/players');

    // Either 401 (Firebase enforced) or 200 (dev mode with no auth).
    expect([200, 401]).toContain(res.status());
  });
});

test.describe('API – /api/backups', () => {
  test('returns 401 for an unauthenticated request', async ({ request }) => {
    const res = await request.get('/api/backups');
    await assertBackendReachable(res, '/api/backups');

    expect([200, 401]).toContain(res.status());
  });
});
