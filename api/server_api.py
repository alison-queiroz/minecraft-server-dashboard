import logging
import os
from functools import wraps

from flask import Flask, jsonify, request, abort

from .player_data import get_players

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Firebase Auth token verification
# ---------------------------------------------------------------------------
# Requires: pip install firebase-admin
# Place the service account JSON at the path below (or set FIREBASE_SA_KEY env var).
# Download it from Firebase Console → Project Settings → Service Accounts.
# ---------------------------------------------------------------------------
_FIREBASE_INITIALIZED = False

def _init_firebase():
    global _FIREBASE_INITIALIZED
    if _FIREBASE_INITIALIZED:
        return
    try:
        import firebase_admin
        from firebase_admin import credentials
        sa_path = os.environ.get("FIREBASE_SA_KEY", "/home/opc/minecraft/firebase-service-account.json")
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
        _FIREBASE_INITIALIZED = True
        logger.info("Firebase Admin SDK initialized.")
    except Exception as exc:
        logger.warning("Firebase Admin SDK not available (%s). API is UNPROTECTED.", exc)


def require_auth(f):
    """Decorator: verify Firebase ID token in Authorization: Bearer <token> header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        _init_firebase()
        if not _FIREBASE_INITIALIZED:
            # Firebase not configured — skip verification (dev fallback only).
            return f(*args, **kwargs)
        from firebase_admin import auth as firebase_auth
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            abort(401)
        token = auth_header[len("Bearer "):]
        try:
            firebase_auth.verify_id_token(token)
        except Exception as exc:
            logger.warning("Token verification failed: %s", exc)
            abort(401)
        return f(*args, **kwargs)
    return decorated


@app.route("/api/players", methods=["GET"])
@require_auth
def players_endpoint():
    return jsonify(get_players())
