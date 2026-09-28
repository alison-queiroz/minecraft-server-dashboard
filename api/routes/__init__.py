"""The API's Flask blueprints, one module per area.

server_api registers every blueprint in BLUEPRINTS. Rules are spelled out in
full (no url_prefix), so each module shows the exact paths it serves.
"""
from __future__ import annotations

from . import accounts, advancements, analytics, backups, catalog, players, profile, status

BLUEPRINTS = (
    catalog.bp,
    profile.bp,
    players.bp,
    backups.bp,
    status.bp,
    analytics.bp,
    accounts.bp,
    advancements.bp,
)
