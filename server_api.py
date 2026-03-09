import os
import glob
import json
import time
import re
import urllib.parse
from datetime import datetime
from flask import Flask, jsonify

app = Flask(__name__)

PLAYERDATA_DIR = os.path.join("world", "playerdata")
USERCACHE_FILE = "usercache.json"

cache_store = {
    "data": [],
    "last_updated": 0
}
CACHE_TTL = 15

def map_uuids():
    uuid_to_name = {}
    if os.path.exists(USERCACHE_FILE):
        with open(USERCACHE_FILE, "r") as file:
            try:
                cache_data = json.load(file)
                for entry in cache_data:
                    uuid_to_name[entry["uuid"]] = entry["name"]
            except json.JSONDecodeError:
                pass
    return uuid_to_name

def get_dimension_name(dim_id):
    dimensions = {
        "minecraft:overworld": "Overworld",
        "minecraft:the_nether": "Nether",
        "minecraft:the_end": "The End"
    }
    return dimensions.get(str(dim_id), "Unknown")

def get_skin_name_from_skinsrestorer(uuid, player_name):
    sr_file = os.path.join("plugins", "SkinsRestorer", "players", f"{uuid}.player")

    if os.path.exists(sr_file):
        try:
            with open(sr_file, "r") as file:
                data = json.load(file)
                identifier = data.get("skinIdentifier", {}).get("identifier", "")

                if identifier:
                    if identifier.startswith("http"):
                        return identifier

                    sr_match = re.match(r'^sr-recommendation-(.+)$', identifier)
                    if sr_match:
                        return sr_match.group(1)

                    return identifier
        except Exception:
            pass

    return player_name

def get_skin_render_url(name, uuid):
    if uuid.startswith("00000000-0000-0000-0009"):
        clean_uuid = uuid.replace("-", "")
        return f"https://api.geysermc.org/v2/render/body/{clean_uuid}"

    actual_skin_name = get_skin_name_from_skinsrestorer(uuid, name)

    if actual_skin_name.startswith("http"):
        # Uses a dedicated image CDN proxy (wsrv.nl) to safely bypass Cloudflare and CORS blocks
        encoded_url = urllib.parse.quote(actual_skin_name, safe='')
        return f"https://wsrv.nl/?url={encoded_url}"

    return f"https://mc-heads.net/skin/{actual_skin_name}"

def fetch_live_data():
    if not os.path.exists(PLAYERDATA_DIR):
        return []

    import nbtlib
    uuid_to_name = map_uuids()
    dat_files = glob.glob(os.path.join(PLAYERDATA_DIR, "*.dat"))
    player_list = []

    for filepath in dat_files:
        uuid = os.path.basename(filepath).replace(".dat", "")
        name = uuid_to_name.get(uuid, "Unknown")

        last_seen_ts = os.path.getmtime(filepath)
        last_seen = datetime.fromtimestamp(last_seen_ts).strftime('%Y-%m-%d %H:%M')

        try:
            nbt_data = nbtlib.load(filepath)
            player_data = {
                "name": name,
                "uuid": uuid,
                "level": int(nbt_data.get('XpLevel', 0)),
                "health": round(float(nbt_data.get('Health', 0)), 1),
                "dimension": get_dimension_name(nbt_data.get('Dimension', 'Unknown')),
                "pos": nbt_data.get('Pos', [0, 0, 0]),
                "last_seen": last_seen,
                "skin_url": get_skin_render_url(name, uuid),
                "is_raw_skin": not uuid.startswith("00000000-0000-0000-0009")
            }
            player_list.append(player_data)
        except Exception:
            pass

    player_list.sort(key=lambda x: x['level'], reverse=True)
    return player_list

@app.route('/api/players', methods=['GET'])
def get_players():
    current_time = time.time()

    if current_time - cache_store["last_updated"] > CACHE_TTL:
        cache_store["data"] = fetch_live_data()
        cache_store["last_updated"] = current_time

    return jsonify(cache_store["data"])

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)
