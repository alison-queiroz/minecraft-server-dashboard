"""Single shared entry point for initializing the Firebase Admin SDK.

Both the request layer (server_api) and the background sync thread
(firestore_sync) used to carry near-identical copies of this logic with
separate module globals that could drift. They now delegate here so there is
one initialization path and one warn-once throttle.
"""
from __future__ import annotations

import logging
import os
import threading

logger = logging.getLogger(__name__)

_initialized = False
_warned = False
_lock = threading.Lock()


def ensure_initialized() -> bool:
    """Initialize firebase_admin if needed. Returns True once available.

    Safe to call on every request: it is a cheap no-op after the first success,
    and while Firebase is unavailable it retries (so the app recovers when the
    dependency comes back) but warns only once to avoid log spam.
    """
    global _initialized, _warned
    if _initialized:
        return True
    with _lock:
        if _initialized:
            return True
        try:
            import firebase_admin
            from firebase_admin import credentials

            # Guard against re-initialization if another code path already
            # called firebase_admin.initialize_app() in this process.
            if not firebase_admin._apps:
                sa_path = os.environ.get(
                    "FIREBASE_SA_KEY",
                    "/home/opc/minecraft/firebase-service-account.json",
                )
                cred = credentials.Certificate(sa_path)
                firebase_admin.initialize_app(cred)
            _initialized = True
            _warned = False
            logger.info("Firebase Admin SDK initialized.")
            return True
        except Exception as exc:  # pylint: disable=broad-except
            if not _warned:
                logger.warning("Firebase Admin SDK not available (%s).", exc)
                _warned = True
            else:
                logger.debug("Firebase init still failing: %s", exc)
            return False


def is_initialized() -> bool:
    return _initialized


def _reset_for_tests() -> None:
    """Test hook: forget cached state so init logic can be re-exercised."""
    global _initialized, _warned
    _initialized = False
    _warned = False
