"""Gunicorn configuration for the Minecraft dashboard API.

Workers are threaded (`gthread`): each of the `workers` processes serves up to
`threads` requests at once, so one slow request (a cold player scan, a slow
Firestore or Drive call) no longer stalls every other client. The in-process
caches in api/ are lock-protected for this. With gthread, `timeout` only kills
a worker whose main loop stops heartbeating, not a long-running request.

Exactly one worker is the sync leader: it holds an flock on SYNC_LOCK_PATH and
is the only process that writes Firestore and the local analytics JSONL. The
others only keep their own in-memory player cache fresh, and retry the lock
every 30 s so a replacement takes over if the leader process dies.

The election only works when each worker imports the app itself, so
`preload_app` MUST stay False: with preloading, the import (and the sync
thread) would run in the pre-fork master, the thread would not survive fork(),
and the workers would inherit the master's state instead of electing a leader.
`post_fork` calls start_background_sync() explicitly as belt-and-suspenders in
case AUTO_START_BG_SYNC is disabled.

Environment overrides: GUNICORN_BIND, GUNICORN_WORKERS (default 2),
GUNICORN_THREADS (default 4).
"""
import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:5000")
workers = int(os.environ.get("GUNICORN_WORKERS", "2"))
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout = 60
graceful_timeout = 30

# Critical: do NOT preload — see module docstring (breaks sync-leader election).
preload_app = False


def post_fork(server, worker):
    # Ensure the per-worker background sync starts even if AUTO_START_BG_SYNC=0.
    from api.player_sync import start_background_sync
    start_background_sync()
