"""Background Firestore sync: one sync leader per host, standbys elsewhere.

Every worker runs one background thread (start_background_sync). The worker
that wins a non-blocking flock on SYNC_LOCK_PATH is the sync leader and runs
_background_sync_loop, the only writer of Firestore and the local analytics
JSONL; the others warm their own player cache and retry the lock every
_LEADER_RETRY_SECONDS, so a replacement takes over if the leader dies.

Importing this module starts the thread unless AUTO_START_BG_SYNC=0 (then
gunicorn's post_fork hook starts it). The player cache, its refresh lock and
the lock/marker paths stay in api/player_data.py, which never imports this
module: they are read through it at call time (``player_data._cache``), so
there is one copy of each and a patch on api.player_data reaches both sides.
"""
from __future__ import annotations

import glob
import logging
import os
import threading
import time

try:
    import fcntl
    _FCNTL_AVAILABLE = True
except ImportError:
    _FCNTL_AVAILABLE = False  # Windows (dev only)

from . import player_data
from .firestore_sync import sync_players
from .skin_resolver import clear_skin_caches

logger = logging.getLogger(__name__)

_LEADER_RETRY_SECONDS = 30.0
_SYNC_POLL_SECONDS = 5.0
_SYNC_DEBOUNCE = 10.0       # seconds of .dat quiet before syncing
_SYNC_MIN_INTERVAL = 60.0   # seconds between leader syncs (one analytics point each)
_sync_lock_fd = None


def _acquire_sync_lock() -> bool:
    """Try (non-blocking) to take the file lock that makes this worker the sync leader.

    Only the leader writes Firestore and the local analytics JSONL. The lock
    is held for the lifetime of the process; a failed attempt closes its
    descriptor so standby workers can keep retrying without leaking fds.
    """
    global _sync_lock_fd
    if not _FCNTL_AVAILABLE:
        return True  # single-process dev env, always run
    try:
        # 0600 so another local user cannot pre-create/hold the lock to
        # suppress the sync leader.
        fd = os.open(player_data._SYNC_LOCK_PATH, os.O_WRONLY | os.O_CREAT, 0o600)
    except OSError:
        logger.warning("Cannot open sync lock file %s", player_data._SYNC_LOCK_PATH, exc_info=True)
        return False
    handle = os.fdopen(fd, "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False  # another worker already holds the lock
    _sync_lock_fd = handle
    return True


class _FileWatcher:
    """Watches a directory for added, removed or modified files (by mtime)."""

    def __init__(self, directory: str, pattern: str = "*.dat") -> None:
        self.directory = directory
        self.pattern = pattern
        self._mtimes: dict[str, float] = {}

    def has_changes(self) -> bool:
        current: dict[str, float] = {}
        for filepath in glob.glob(os.path.join(self.directory, self.pattern)):
            try:
                current[filepath] = os.path.getmtime(filepath)
            except OSError:
                continue  # vanished between glob and stat (e.g. a save's temp file)
        # Rebuilt each poll, so vanished (temp) files do not accumulate.
        changed = current != self._mtimes
        self._mtimes = current
        return changed


def _background_sync_loop() -> None:
    """Sync-leader loop: the only writer of Firestore and the local analytics JSONL.

    - Syncs right after start (the first sync writes every player doc), then
      every _SYNC_MIN_INTERVAL s: rescan disk into this worker's cache, then
      write the minute's analytics snapshot plus only the player docs whose
      content changed (firestore_sync.sync_players).
    - Polls every _SYNC_POLL_SECONDS (cheap mtime checks) and defers a sync
      until player .dat files have been quiet for _SYNC_DEBOUNCE s.
    - Backoff: on error, waits up to 5 extra minutes before retrying.
    - SkinsRestorer player-file changes and resync requests from
      invalidate_caches() (any worker) clear this worker's skin caches, so
      the next sync re-resolves skins.
    - Never exits: an unexpected error is logged and the loop carries on,
      because a dead leader thread would keep the lock with nobody syncing.
    """
    playerdata_watcher = _FileWatcher(player_data._PLAYERDATA_DIR)
    sr_watcher = _FileWatcher(player_data._SR_PLAYERS_DIR, pattern="*")
    resync_watcher = _FileWatcher(
        glob.escape(os.path.dirname(player_data._RESYNC_REQUEST_PATH) or "."),
        glob.escape(os.path.basename(player_data._RESYNC_REQUEST_PATH)),
    )
    for watcher in (playerdata_watcher, sr_watcher, resync_watcher):
        watcher.has_changes()  # baseline; the startup sync covers anything older
    backoff = 0.0
    last_change = time.time() - _SYNC_DEBOUNCE
    next_sync_after = 0.0  # 0 = sync on the first iteration

    while True:
        time.sleep(_SYNC_POLL_SECONDS)
        try:
            if playerdata_watcher.has_changes():
                last_change = time.time()
            skins_changed = sr_watcher.has_changes()
            resync_requested = resync_watcher.has_changes()
            if skins_changed or resync_requested:
                with player_data._refresh_lock:
                    clear_skin_caches()
                    player_data._cache.invalidate()
                logger.info("Skin sources changed or a resync was requested; skin caches cleared.")
        except Exception:
            logger.warning("Sync leader could not poll for file changes.", exc_info=True)

        now = time.time()
        if now - last_change >= _SYNC_DEBOUNCE and now >= next_sync_after:
            try:
                with player_data._refresh_lock:
                    fresh = player_data._refresh_cache()
                sync_players(fresh)
                backoff = 0.0
                next_sync_after = time.time() + _SYNC_MIN_INTERVAL
                logger.debug("Leader sync completed.")
            except Exception:
                backoff = min(backoff + 60.0, 300.0)
                next_sync_after = now + _SYNC_MIN_INTERVAL + backoff
                logger.warning("Background player sync failed (next retry in %.0fs)", _SYNC_MIN_INTERVAL + backoff, exc_info=True)


def _sync_thread_main() -> None:
    """Per-worker background thread: run the leader loop, or stand by for it.

    A worker that loses the flock election warms its own player cache (so its
    first request skips the scan) and retries the lock every
    _LEADER_RETRY_SECONDS: the kernel releases the lock when the leader
    process exits, so a surviving or replacement worker takes over.
    """
    if not _acquire_sync_lock():
        logger.info("Background sync lock not acquired; another worker is the sync leader. Standing by.")
        try:
            player_data.get_players()
        except Exception:
            logger.warning("Player cache warm-up failed.", exc_info=True)
        while not _acquire_sync_lock():
            time.sleep(_LEADER_RETRY_SECONDS)
    logger.info("This worker is the sync leader (writes Firestore and the analytics JSONL).")
    _background_sync_loop()


_bg_sync_thread: threading.Thread | None = None


def start_background_sync() -> None:
    """Start this worker's background sync thread (leader or standby).

    Idempotent (safe to call once per worker). Under gunicorn, call this from a
    ``post_fork`` hook with ``preload_app = False`` (see gunicorn.conf.py) so the
    file-lock leader election runs per worker rather than in the pre-fork master,
    where the thread would not survive the fork.
    """
    global _bg_sync_thread
    if _bg_sync_thread is not None:
        return
    _bg_sync_thread = threading.Thread(target=_sync_thread_main, daemon=True, name="player-bg-sync")
    _bg_sync_thread.start()


# Auto-start on import preserves the dev (run.py) and non-preload gunicorn
# behaviour: api/server_api.py imports this module, so loading the app starts
# the thread. Set AUTO_START_BG_SYNC=0 when a gunicorn post_fork hook starts it.
if os.environ.get("AUTO_START_BG_SYNC", "1") != "0":
    start_background_sync()
