"""Flask app for the Minecraft dashboard API.

Creates the app (request-size cap, compression, JSON error bodies) and
registers one blueprint per area from api/routes/. run.py, gunicorn and the
systemd unit load it as ``api.server_api:app``, so this module and the
``app`` name must stay.
"""
# Production runs Python 3.9, where PEP 604 unions (`int | None`) in an
# annotation are evaluated at runtime and raise. Defer annotations so modern
# syntax stays safe — enforced across api/ by tests/test_python39_compat.py.
from __future__ import annotations

import logging

from flask import Flask, jsonify
from flask_compress import Compress
from werkzeug.exceptions import HTTPException
from werkzeug.wrappers import Response

# Importing player_sync starts this worker's background Firestore sync (leader
# or standby) unless AUTO_START_BG_SYNC=0, as importing player_data did before
# the sync loop moved into its own module.
from . import player_sync  # noqa: F401
from .routes import BLUEPRINTS, backups, players

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = Flask(__name__)

# Gzip/Brotli-compress JSON responses (players/analytics payloads shrink a lot);
# only kicks in when the client sends Accept-Encoding, so it's a no-op in tests.
Compress(app)

# Generous cap on request bodies: the largest legitimate payload is the
# services-catalog PUT (a few KB). Anything bigger is rejected with a 413.
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024


@app.errorhandler(HTTPException)
def _json_http_error(exc: HTTPException) -> Response:
    """Render abort()/HTTP errors as {"error": "<reason>"} JSON instead of
    Flask's HTML pages. Only the standard reason phrase is sent (never the
    exception text), and protocol headers such as Allow/Retry-After are kept."""
    response = jsonify({"error": exc.name})
    response.status_code = exc.code or 500
    for name, value in exc.get_headers():
        if name.lower() != "content-type":
            response.headers[name] = value
    return response


for _blueprint in BLUEPRINTS:
    app.register_blueprint(_blueprint)


def _reset_for_tests() -> None:
    """Test hook: forget process-wide throttles/caches so tests are order-independent."""
    players._reset_for_tests()
    backups._reset_for_tests()
