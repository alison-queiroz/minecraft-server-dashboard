# EV Minecraft Server Dashboard

Private dashboard for the EV Minecraft server: live status, players (skins, stats,
advancements), world map, backups, analytics and linked-account profiles.
Installable as a PWA.

## Stack

| Layer    | Tech                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Frontend | Angular 22 (standalone, zoneless, signals + OnPush), Tailwind CSS 3, Chart.js, skinview3d, Angular service worker |
| Auth     | Firebase Auth (Google sign-in) in the browser; the API verifies ID tokens with `firebase-admin`                   |
| Backend  | Flask API (`api/`), gunicorn in production, background Firestore sync                                             |
| Tests    | Vitest + Analog (unit), pytest (API), Playwright + axe-core (e2e / accessibility)                                 |
| Hosting  | Oracle Cloud VM behind nginx (static files pre-compressed with brotli + gzip)                                     |

## Prerequisites

- Node.js 24 (npm 11 — older npm rejects the lockfile)
- Python 3.9+ (production runs 3.9; `tests/test_python39_compat.py` guards it)

## Setup

```bash
npm ci                  # frontend deps + husky git hooks
npm run backend:setup   # creates .venv and installs api/requirements*.txt
npm run e2e:setup       # Playwright's Chromium (once)
```

All npm scripts work on Windows, Linux and macOS: Python commands go through
`scripts/venv-python.mjs`, which resolves `.venv/Scripts/python.exe` or `.venv/bin/python`.

## Development

```bash
npm run backend:start   # Flask API on http://127.0.0.1:5000
npm start               # Angular dev server on http://localhost:4300 (proxies /api -> :5000)
```

Useful API environment variables: `FIREBASE_SA_KEY` (service-account JSON; without it
auth-protected endpoints answer 503), `MINECRAFT_DIR`, `MC_HOST` / `MC_PORT`,
`AUTO_START_BG_SYNC=0` (skip the background Firestore sync locally).

## Tests

| Command                                          | What                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm test` / `npm run test:coverage`             | Vitest unit tests (jsdom, zoneless TestBed)                             |
| `npm run test:api` / `npm run test:api:coverage` | pytest for `api/` (`:coverage:100` enforces 100 %)                      |
| `npm run e2e:playwright` (alias `npm run e2e`)   | Starts the API, then Playwright (starts/reuses the dev server on :4300) |
| `npm run e2e:ui`                                 | Same, in Playwright's UI mode                                           |

`e2e/a11y.spec.ts` runs axe-core (WCAG 2.1 A/AA) on every route in light and dark mode.
Most e2e specs mock Firebase and `/api/*` (see `e2e/helpers.ts`); `api-contracts.spec.ts`
needs the real API.

## Quality gates

- **pre-commit** (husky): `npm run lint`
- **pre-push** (husky): `npm run ci:quality` = lint + `typecheck:strict` + Vitest + pytest
- **CI** (`.github/workflows/ci.yml`): lint/typecheck, unit (Vitest + pytest), e2e and
  production build as separate required checks; `master` only accepts PRs.
- Coding rules: [`.github/quality-standards.instructions.md`](.github/quality-standards.instructions.md)

## Build

```bash
npx ng build --configuration production        # -> dist/minecraft-server-dashboard/browser
npm run assets:precompress                     # writes .br / .gz siblings for nginx
npm run analyze:bundle-report                  # optional; needs a build with --stats-json
```

The production build enforces an initial-bundle budget (warning 700 kB, error 800 kB).
`scripts/precompress.mjs` lets nginx serve static files via `brotli_static` / `gzip_static`
with no per-request compression.

## Deployment

- **`release.yml`** (GitHub Actions, on push to `master`): build, pre-compress, pack; deploys
  to the Oracle VM when the `ENABLE_GH_DEPLOY` variable and `ORACLE_*` secrets are set.
- **`deploy.bat`** (local, Windows): runs the checks in parallel, builds, uploads the API
  and restarts `minecraft-api.service`, applies the nginx scripts, then uploads the
  pre-compressed frontend. `--skip-checks` deploys without the checks.
- nginx provisioning (BlueMap proxy, brotli/gzip) lives in [`config/`](config/).

## Architecture notes

- **Thin frontend.** Aggregation, filtering, grouping, sorting of large data sets and business
  rules belong in the Flask API (or its storage queries). The browser renders and handles
  interaction; it should not download raw data to crunch client-side.
- `src/main.ts` bootstraps the app: zoneless change detection, HTTP interceptors, the
  service worker and the lazy-loaded, guarded routes (each with its own page title).
- `src/app/pages/` holds routed pages; reusable UI lives in `src/app/components/`
  (`layout`, `player`, `profile`, `server`, `shared`), state and API access in
  `src/app/services/`.
- Light/dark mode: `ThemeService` toggles the `dark` class on `<html>`; a small inline
  script in `src/index.html` applies the saved theme before first paint (kept in sync by
  `theme.service.spec.ts`).
- The API (`api/server_api.py`, one Flask blueprint per area in `api/routes/`) runs
  under gunicorn in production; keep `preload_app = False` in `gunicorn.conf.py` (see its
  docstring).
