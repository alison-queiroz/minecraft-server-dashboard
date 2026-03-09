import logging

from flask import Flask, jsonify

from .player_data import get_players

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = Flask(__name__)


@app.route("/api/players", methods=["GET"])
def players_endpoint():
    return jsonify(get_players())
