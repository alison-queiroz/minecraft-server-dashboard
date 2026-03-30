import logging
import os
from functools import wraps

from flask import Flask, jsonify, request, abort

from .player_data import get_players

# Google Drive API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

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
    @wraps(f)
    def decorated(*args, **kwargs):
        _init_firebase()
        if not _FIREBASE_INITIALIZED:
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


@app.route("/api/backups", methods=["GET"])
@require_auth
def backups_endpoint():
    try:
        creds_path = os.environ.get("DRIVE_SA_KEY", "/home/opc/minecraft/drive-service-account.json")
        creds = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        service = build('drive', 'v3', credentials=creds)

        # Determine which folder to query: requested folder or root folder
        root_folder_id = os.environ.get("DRIVE_FOLDER_ID", "YOUR_GOOGLE_DRIVE_FOLDER_ID")
        target_folder_id = request.args.get('folderId', root_folder_id)

        query = f"'{target_folder_id}' in parents and trashed = false"

        results = service.files().list(
            q=query,
            fields="files(id, name, mimeType, createdTime, size, webContentLink)",
            orderBy="folder, createdTime desc"
        ).execute()

        return jsonify(results.get('files', []))

    except Exception as exc:
        logger.error("Failed to fetch backups from Google Drive: %s", exc)
        return jsonify({"error": "Failed to fetch backups"}), 500
