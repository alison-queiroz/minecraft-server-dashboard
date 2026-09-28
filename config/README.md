# Deploy & server configuration

Everything that runs **on the Oracle Linux 9 VM** lives here. Both deploy
pipelines — `deploy.bat` (local, Windows) and `.github/workflows/release.yml`
(GitHub Actions) — upload the same files and run the same server-side script,
so they cannot drift apart.

| File                         | Runs as                                  | Purpose                                                                                                                         |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `remote-deploy.sh`           | SSH user (`opc`), `sudo -n` where needed | Server half of every deploy: `backend`, `nginx`, `resync`, `frontend`, `backend-rollback`, `frontend-rollback` phases.          |
| `setup-nginx-map.sh`         | root (via `remote-deploy.sh nginx`)      | BlueMap `sub_filter` injection (iframe URL `postMessage` + SW unregister) and the maps that scope its cache/encoding overrides. |
| `setup-nginx-compression.sh` | root (via `remote-deploy.sh nginx`)      | Installs `nginx-mod-brotli` if missing and enables `brotli_static` / `gzip_static`.                                             |

## Deploy flow

Both pipelines upload into a private inbox, `~/.dashboard-deploy` (mode 700):
`remote-deploy.sh`, both `setup-nginx-*.sh`, `deploy_api.tar.gz`
(`api/` + `run.py` + `gunicorn.conf.py`, without `__pycache__`) and
`deploy_build.tar.gz` (the precompressed Angular build). Then they run:

```sh
bash ~/.dashboard-deploy/remote-deploy.sh backend nginx resync
bash ~/.dashboard-deploy/remote-deploy.sh frontend
```

**`deploy.bat`**: quality gate + tests (skipped with `--skip-tests` /
`--skip-checks` / `--deploy-only`) → `ng build` starts in the background →
_while it builds_: pack + upload the API bundle, run
`backend nginx resync` → wait for the build, fail on any build error →
precompress, pack, upload → `frontend`. Nothing under `/var/www` changes
before every build check has passed. Server and key can be overridden without
editing the file: `DEPLOY_SERVER_IP`, `DEPLOY_SERVER_USER`, `DEPLOY_KEY_PATH`.

**`release.yml`**: the `build` job produces `deploy_build.tar.gz`; the
`deploy` job (only with `vars.ENABLE_GH_DEPLOY == 'true'`) packs the API,
uploads the bundle and runs the same two commands. A failed backend phase
fails the job before the frontend is touched.

The phases themselves are serialised with `flock`, but the uploads are not:
don't run `deploy.bat` while a GitHub deploy is in progress. If the SSH
connection drops mid-run, the script ignores the hangup and finishes (or rolls
back) on the server; re-run the pipeline to see the outcome.

### What each phase does

**`backend`** — nothing live changes until the new release is proven good:

1. Extract `deploy_api.tar.gz` into `/home/opc/minecraft/.deploy-staging`.
2. Byte-compile every staged `.py` with the server's interpreter (catches
   syntax newer than Python 3.9).
3. `python3 -m pip install -q -r` the **staged** `requirements.txt`, constrained
   by `requirements-lock.txt` (the exact transitive versions CI tested).
4. Import smoke test: `import run` from the staged tree with
   `AUTO_START_BG_SYNC=0` (catches missing deps and import-time errors).
5. Stop `minecraft-api.service` → `api/` becomes `api.prev/`, staged `api/`
   moves in (atomic renames), `run.py` / `gunicorn.conf.py` replaced (old
   copies kept as `*.prev`) → clear `__pycache__` → start.
6. Poll `GET http://127.0.0.1:5000/api/healthz` for up to 30 s. If it never
   answers `200 {"ok": true}`: restore `api.prev` + `*.prev`, restart, print
   the journal and **exit non-zero** (the pipeline stops; the frontend is not
   published).

Files that exist only on the server inside `api/` (not `*.py`) are carried
over into the new release with a warning; modules deleted from the repo are
dropped (a copy stays in `api.prev`). If the unit's `ExecStart` is a Python
binary or lives in a virtualenv, that interpreter is used instead of
`python3`; the resolved command line is printed at the start of the phase.

**`frontend`** — the docroot is never emptied:

1. Extract `deploy_build.tar.gz` into `/var/www/dashboard.staging`, chown it
   like the docroot, `chmod u=rwX,go=rX` (the Windows `tar` stores 0666/0777
   modes, which the old root extraction kept), `restorecon` when SELinux is on.
2. Verify the build: `index.html` and `ngsw.json` present, **every
   `ngsw.json` hashTable entry exists with a matching SHA-1**, and every local
   script/stylesheet referenced by `index.html` exists.
3. Publish into `/var/www/dashboard` file by file (copy to a temp name in the
   target directory, then `mv` — atomic per file; unchanged files are skipped
   so their ETag stays stable): all hashed chunks, assets and `.br`/`.gz`
   siblings first, then `ngsw-worker.js`, `safety-worker.js`,
   `worker-basic.min.js`, `manifest.webmanifest`, `index.html` and finally
   `ngsw.json`. A `.br`/`.gz` sibling the new build no longer ships is
   deleted right away (nginx would otherwise keep serving it).
4. Files that just left the build get their mtime set to "now"; files that
   are neither in the current build nor were superseded in the last
   **14 days** are pruned. Open tabs and service-worker clients on the
   previous version can keep lazy-loading their chunks. Dot paths
   (`.well-known/`) are never touched.
5. The pristine build is kept as `/var/www/dashboard.release`, the previous
   one as `dashboard.release.prev` (rollback source).

**`nginx`** — runs `setup-nginx-map.sh` then `setup-nginx-compression.sh`
(BOM/CRLF stripped first). Both only reload nginx when they changed
something; reloads are graceful.

**`resync`** — `POST /api/internal/force-resync`. `INTERNAL_API_SECRET` is
read from the running service's environment (`/proc/<MainPID>/environ`,
which covers `Environment=`, `EnvironmentFile=` and drop-ins), falling back
to `systemctl show -p Environment` / `-p EnvironmentFiles`. It is written to
a 0600 temp file and sent with `curl -H @file`, so it never appears in a
command line or `ps`. Failure is a warning, not a deploy failure.

### Where downtime can still happen

- **API:** between `systemctl stop` and the new workers answering — a few
  seconds, like any restart (nginx answers `502` for `/api` meanwhile). A
  failed release adds the 30 s health window plus a second restart.
- **Frontend:** none expected. If a run dies _during_ the final entry-file
  step, `index.html` and `ngsw.json` can briefly come from different builds;
  both reference files that exist, and re-running the deploy fixes it.
- Tabs left open for more than 14 days on an old version may 404 on a
  lazy chunk that has since been pruned.

## Server layout

| Path                                                     | What                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `~/.dashboard-deploy/`                                   | Upload inbox: scripts, tarballs, `.deploy.lock` (serialises concurrent deploys via `flock`). |
| `/home/opc/minecraft/api/`                               | Live API package.                                                                            |
| `/home/opc/minecraft/api.prev/`                          | Previous release (rollback source), replaced on the next successful swap.                    |
| `/home/opc/minecraft/api.failed/`                        | Last release that was rolled back (for inspection).                                          |
| `/home/opc/minecraft/{run.py,gunicorn.conf.py}[.prev]`   | Entry point + gunicorn config, previous copies.                                              |
| `/home/opc/minecraft/.deploy-staging/`                   | Transient backend staging area.                                                              |
| `/var/www/dashboard/`                                    | Live docroot (current build + recently superseded chunks).                                   |
| `/var/www/dashboard.release/`, `dashboard.release.prev/` | Pristine current / previous build.                                                           |
| `/var/www/dashboard.staging/`                            | Transient frontend staging area.                                                             |
| `/etc/nginx/conf.d/minecraft_map_vars.conf`              | `map{}` blocks written by `setup-nginx-map.sh`.                                              |
| `/etc/nginx/minecraft_map*.conf.bak`                     | Backups taken before the last BlueMap config change (outside `conf.d`, never loaded).        |

## Rollback

- **Backend, automatic:** a release that fails its health check is rolled back
  by the `backend` phase itself.
- **Backend, manual** (e.g. a bug found after a successful deploy):
  `ssh opc@<host> 'bash ~/.dashboard-deploy/remote-deploy.sh backend-rollback'`
  restores `api.prev` + `*.prev` and restarts. pip packages are _not_
  downgraded.
- **Frontend, manual:**
  `ssh opc@<host> 'bash ~/.dashboard-deploy/remote-deploy.sh frontend-rollback'`
  republishes `dashboard.release.prev` with the same ordering (running it again
  rolls forward).
- Or redeploy an older commit with either pipeline.

Settings for manual runs (environment variables, defaults in brackets):
`DEPLOY_HEALTH_TIMEOUT` [30], `DEPLOY_PRUNE_DAYS` [14], `DEPLOY_PYTHON`
[auto / `python3`], `DEPLOY_SKIP_IMPORT_CHECK=1` (bypass the import smoke
test), `DEPLOY_API_URL` [`http://127.0.0.1:5000`], `DEPLOY_SERVICE`,
`DEPLOY_API_ROOT`, `DEPLOY_WWW_DIR`.

## BlueMap (`setup-nginx-map.sh`)

The script used to inject `proxy_set_header Accept-Encoding ""` and
`Cache-Control: no-store` for the whole BlueMap location, so every tile was
re-downloaded uncompressed on every map open. The injected directives now read
http-level maps from `conf.d/minecraft_map_vars.conf`:

- `Accept-Encoding` is dropped only for `/`, `*.htm(l)` and extension-less
  URIs, so `sub_filter` still receives uncompressed HTML; tiles keep gzip.
- `Cache-Control: no-cache, no-store, must-revalidate` + `Pragma: no-cache`
  only on `text/html`; every other response gets `Cache-Control: no-cache`
  (revalidate instead of re-download) and no `Pragma`.

It edits a temp copy, backs up the live files, runs `nginx -t` and reloads,
or restores the backups when the test fails.

## Recommended nginx settings for the dashboard (apply by hand)

The dashboard's own server block is **not** in this repo. Merge the snippet
below into it by hand — keep the existing `server_name`, certificates and the
`/api` proxy lines — then `sudo nginx -t && sudo systemctl reload nginx`.

```nginx
server {
    # nginx 1.20 (the VM): HTTP/2 is a listen flag. On nginx >= 1.25.1 use
    # `listen 443 ssl;` plus `http2 on;` instead.
    listen 443 ssl http2;
    # server_name / ssl_certificate / ssl_certificate_key: keep the existing ones.

    root  /var/www/dashboard;
    index index.html;

    # Vary: Accept-Encoding on compressed responses (brotli_static /
    # gzip_static are enabled http-wide by setup-nginx-compression.sh).
    gzip_vary on;

    # Entry points and service-worker control files: always revalidate, so a
    # deploy is picked up on the next load (ETag makes that a cheap 304).
    location ~ ^/(?:index\.html|ngsw\.json|ngsw-worker\.js|safety-worker\.js|worker-basic\.min\.js|manifest\.webmanifest)$ {
        add_header Cache-Control "no-cache" always;
    }

    # Content-hashed build output (main-47RQUNVN.js, chunk-DQ31T-qa.js,
    # styles-2QPP3RQ2.css): the name changes with the content, cache forever.
    # No `always`, so a 404 is never cached for a year.
    location ~ "^/[a-z]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$" {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }
    location ^~ /media/ {          # hashed files referenced from CSS
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Unhashed assets: short max-age, then revalidate (ETag is on by default).
    location ^~ /assets/ {
        add_header Cache-Control "public, max-age=3600";
        try_files $uri =404;
    }

    location /api/ {
        # ...existing proxy_pass / proxy_set_header lines stay here...
        add_header Cache-Control "no-store" always;
    }

    # SPA fallback: deep links get index.html (through the no-cache location).
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Checked with `nginx -t` on nginx 1.20.2 and by requesting each path: entry
files and deep links → `no-cache`; hashed chunks, CSS and `/media/` →
`immutable`; `/assets/` → `max-age=3600`; `/api/` → `no-store`; 404s → no
cache header.

Watch out for:

- **`add_header` inheritance**: a location that has its own `add_header`
  drops _all_ `add_header`s from the server level. If the server block sets
  security headers (HSTS, `X-Content-Type-Options`, CSP, ...), repeat them in
  each location above — e.g. put them in a file and `include` it in each one.
- Keep any existing special locations (ACME `/.well-known/`, a location that
  serves an API-managed `services-catalog.json`, ...) and check where regex
  locations now take precedence over them.
- The hashed-file regex assumes every root-level `name-XXXXXXXX.js|css` is
  content-hashed, which holds for the Angular `application` builder output.

## Server prerequisites and the first deploy

Nothing new needs to be installed: the scripts use `bash`, `tar`, `curl`,
`python3`, `flock` and coreutils, all present on Oracle Linux 9 (rsync is not
used; `cmp` is optional). `opc` needs passwordless `sudo`, as before.

On the first deploy with this flow, watch:

- The `backend: ... runs '<ExecStart>' in '<WorkingDirectory>'; using <python>`
  line: confirm the interpreter is the one the service imports from.
- A `gunicorn.conf.py differs from the release` diff — this file was never
  shipped before; the old copy is kept as `gunicorn.conf.py.prev`.
- `carried over server-only file api/...` warnings: move those files out of
  `api/` or commit them.
- The healthz poll: the 30 s window must cover a cold gunicorn boot on the VM
  (raise `DEPLOY_HEALTH_TIMEOUT` if it gets close).
- `resync:` should end in `[SUCCESS]`; a warning about `INTERNAL_API_SECRET`
  means the unit has no such variable.
- The first `frontend` run treats everything currently in the docroot as the
  previous build (kept 14 days) and prints what it published and pruned.
- The old `/tmp/setup-nginx-*.sh` / `/tmp/deploy_build.tar.gz` paths are no
  longer used.
