"""Gunicorn configuration for the Minecraft dashboard API.

The background Firestore-sync thread elects a single leader across workers using
an flock on a lock file, acquired at module import time. That scheme only works
when each worker imports the app itself, so `preload_app` MUST stay False:
with preloading, the import (and the thread + lock) would run in the pre-fork
master, the thread would not survive fork(), and every worker would then fail to
acquire the lock — leaving no worker running the sync loop.

Keeping preload_app = False lets the existing per-worker import + file-lock
election work correctly. `post_fork` calls start_background_sync() explicitly as
belt-and-suspenders in case AUTO_START_BG_SYNC is disabled.
"""
import os

# Bind/worker counts can be overridden via the environment.
bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:5000")
workers = int(os.environ.get("GUNICORN_WORKERS", "2"))

# Critical: do NOT preload — see module docstring (breaks sync-leader election).
preload_app = False


def post_fork(server, worker):
    # Ensure the per-worker background sync starts even if AUTO_START_BG_SYNC=0.
    from api.player_data import start_background_sync
    start_background_sync()
