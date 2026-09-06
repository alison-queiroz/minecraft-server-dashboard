"""Pytest session setup.

Disable the background Firestore-sync thread during tests. It is auto-started
when api.player_data is imported; left running, its periodic sync calls
sync_players() in the background and can pollute mocks (e.g. a patched
logger.warning) in unrelated tests. This must run before api.player_data is
imported, which pytest guarantees by loading conftest.py before test modules.
"""
import os

os.environ.setdefault("AUTO_START_BG_SYNC", "0")
