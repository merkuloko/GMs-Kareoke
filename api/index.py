from dotenv import load_dotenv
load_dotenv()

import json
import os
import sqlite3
from urllib.parse import quote_plus

import requests
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS


current_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(current_dir)

app = Flask(
    __name__,
    template_folder=os.path.join(base_dir, "templates"),
    static_folder=os.path.join(base_dir, "static"),
)

CORS(app)

HTTP_TIMEOUT_SECONDS = 10
DEFAULT_DB_CANDIDATES = ("karaoke.db", "kareoke.db")
SUPABASE_TABLE = os.environ.get("SUPABASE_SONGS_TABLE", "songs")
SUPABASE_LEADERBOARD_TABLE = os.environ.get(
    "SUPABASE_LEADERBOARD_TABLE", "leaderboard_entries"
)
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()
MOBILE_QUEUE_URL = os.environ.get("MOBILE_QUEUE_URL", "").strip()


def resolve_db_path():
    configured_path = os.environ.get("KARAOKE_DB_PATH", "").strip()
    if configured_path:
        return configured_path

    for candidate in DEFAULT_DB_CANDIDATES:
        candidate_path = os.path.join(base_dir, candidate)
        if os.path.exists(candidate_path):
            return candidate_path

    return os.path.join(base_dir, DEFAULT_DB_CANDIDATES[0])


def get_db_connection():
    db_path = resolve_db_path()
    if not os.path.exists(db_path):
        return None

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def normalize_song(song):
    normalized = dict(song)
    rhythm_map = normalized.get("rhythm_map")

    if isinstance(rhythm_map, str):
        try:
            normalized["rhythm_map"] = json.loads(rhythm_map)
        except json.JSONDecodeError:
            normalized["rhythm_map"] = []
    elif rhythm_map is None:
        normalized["rhythm_map"] = []

    return normalized


def get_supabase_credentials():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_ANON_KEY", "").strip()
        or os.environ.get("SUPABASE_KEY", "").strip()
    )

    if bool(url) != bool(key):
        raise RuntimeError("SUPABASE_URL and a Supabase key must be set together")

    if not url:
        return None

    if "supabase.com/dashboard" in url:
        raise RuntimeError(
            "SUPABASE_URL must be the project API URL, for example https://your-project-ref.supabase.co"
        )

    return {"url": url, "key": key}


def is_supabase_enabled():
    try:
        return get_supabase_credentials() is not None
    except RuntimeError:
        return False


def supabase_request(method, path, query_string="", payload=None, prefer=None):
    credentials = get_supabase_credentials()
    if credentials is None:
        raise RuntimeError("Supabase is not configured")

    headers = {
        "apikey": credentials["key"],
        "Authorization": f"Bearer {credentials['key']}",
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer

    url = f"{credentials['url']}/rest/v1/{path}"
    if query_string:
        url = f"{url}?{query_string}"

    response = requests.request(
        method,
        url,
        headers=headers,
        json=payload,
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()

    if response.status_code == 204 or not response.content:
        return None

    content_type = response.headers.get("Content-Type", "")
    if "application/json" in content_type:
        return response.json()

    return None


def fetch_songs():
    if is_supabase_enabled():
        data = supabase_request(
            "GET",
            SUPABASE_TABLE,
            "select=id,title,artist,youtube_id,rhythm_map&order=title.asc",
        )
        return [normalize_song(song) for song in data]

    conn = get_db_connection()
    if conn is None:
        return []

    songs = conn.execute(
        "SELECT id, title, artist, youtube_id, rhythm_map FROM songs ORDER BY title ASC"
    ).fetchall()
    conn.close()
    return [normalize_song(dict(row)) for row in songs]


def fetch_song_by_id(song_id):
    if is_supabase_enabled():
        query = f"select=*&id=eq.{song_id}&limit=1"
        data = supabase_request("GET", SUPABASE_TABLE, query)
        return normalize_song(data[0]) if data else None

    conn = get_db_connection()
    if conn is None:
        return None

    song = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    conn.close()
    return normalize_song(dict(song)) if song else None


def fetch_leaderboard():
    if not is_supabase_enabled():
        return []

    data = supabase_request(
        "GET",
        SUPABASE_LEADERBOARD_TABLE,
        "select=id,singer_name,score,song_title,created_at"
        "&order=score.desc,created_at.asc"
        "&limit=5",
    )

    return [
        {
            "id": entry["id"],
            "name": entry.get("singer_name", "Anonymous Singer"),
            "score": entry.get("score", 0),
            "song_title": entry.get("song_title", ""),
            "created_at": entry.get("created_at"),
        }
        for entry in data or []
    ]


def create_leaderboard_entry(payload):
    if not is_supabase_enabled():
        raise RuntimeError("Supabase is not configured")

    singer_name = (payload.get("name") or "").strip()[:15] or "Anonymous Singer"
    score = payload.get("score", 0)
    song_title = (payload.get("song_title") or "").strip() or "Karaoke Song"

    try:
        score = int(score)
    except (TypeError, ValueError) as error:
        raise ValueError("Score must be a number") from error

    if score < 0:
        raise ValueError("Score must be zero or greater")

    data = supabase_request(
        "POST",
        SUPABASE_LEADERBOARD_TABLE,
        payload={
            "singer_name": singer_name,
            "score": score,
            "song_title": song_title,
        },
        prefer="return=representation",
    )

    return {
        "id": data[0]["id"] if data else None,
        "name": singer_name,
        "score": score,
        "song_title": song_title,
    }


def clear_leaderboard():
    if not is_supabase_enabled():
        return None

    return supabase_request(
        "DELETE",
        SUPABASE_LEADERBOARD_TABLE,
        "id=gt.0",
        prefer="return=minimal",
    )


@app.route("/")
def home():
    return render_template(
        "index.html",
        mobile_queue_url=MOBILE_QUEUE_URL,
        mobile_queue_enabled=bool(MOBILE_QUEUE_URL),
    )


@app.route("/mobile")
def mobile_queue():
    return render_template("mobile.html")


@app.route("/api/config")
def get_config():
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "")

    return jsonify({
        "supabase_url": supabase_url,
        "supabase_key": supabase_anon_key,
        "mobile_queue_url": MOBILE_QUEUE_URL,
        "mobile_queue_enabled": bool(MOBILE_QUEUE_URL),
        "songs_backend": "supabase" if is_supabase_enabled() else "sqlite"
    })


@app.route("/api/songs")
def get_songs():
    try:
        songs = fetch_songs()
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except requests.RequestException:
        return jsonify({"error": "Song service unavailable"}), 502

    return jsonify(
        [
            {
                "id": song["id"],
                "title": song["title"],
                "artist": song["artist"],
                "youtube_id": song.get("youtube_id"),
                "rhythm_map": song.get("rhythm_map", []),
            }
            for song in songs
        ]
    )


@app.route("/api/songs/<int:song_id>")
def get_song_detail(song_id):
    try:
        song = fetch_song_by_id(song_id)
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except requests.RequestException:
        return jsonify({"error": "Song service unavailable"}), 502

    if song is None:
        return jsonify({"error": "Song not found"}), 404

    return jsonify(song)


@app.route("/api/search")
def search_youtube():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "No query provided"}), 400

    if not YOUTUBE_API_KEY:
        return jsonify({"error": "YouTube search is not configured"}), 503

    params = {
        "part": "snippet",
        "q": f"{query} karaoke",
        "type": "video",
        "maxResults": 5,
        "key": YOUTUBE_API_KEY,
    }

    try:
        response = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException:
        return jsonify({"error": "YouTube API failed"}), 502

    data = response.json()
    results = []
    for item in data.get("items", []):
        video_id = item.get("id", {}).get("videoId")
        snippet = item.get("snippet", {})
        thumbnails = snippet.get("thumbnails", {})
        thumb = thumbnails.get("medium") or thumbnails.get("default") or {}
        if not video_id:
            continue

        results.append(
            {
                "id": video_id,
                "title": snippet.get("title", "Untitled"),
                "thumbnail": thumb.get("url", ""),
            }
        )

    return jsonify(results)


@app.route("/api/leaderboard", methods=["POST"])
@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    try:
        return jsonify(fetch_leaderboard())
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except requests.RequestException:
        return jsonify({"error": "Leaderboard service unavailable"}), 502


@app.route("/api/leaderboard", methods=["POST"])
def save_score():
    data = request.get_json(silent=True) or {}
    try:
        entry = create_leaderboard_entry(data)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except requests.RequestException:
        return jsonify({"error": "Leaderboard service unavailable"}), 502

    return jsonify(entry), 201


@app.route("/api/leaderboard", methods=["DELETE"])
def delete_leaderboard():
    try:
        clear_leaderboard()
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500
    except requests.RequestException:
        return jsonify({"error": "Leaderboard service unavailable"}), 502

    return jsonify({"status": "cleared"})


@app.route("/api/queue-qr")
def queue_qr():
    if not MOBILE_QUEUE_URL:
        return jsonify({"error": "Mobile queue URL not configured"}), 404

    qr_url = (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=110x110&data={quote_plus(MOBILE_QUEUE_URL)}&bgcolor=0f0f0f&color=00e5b0"
    )
    return jsonify({"url": qr_url, "target": MOBILE_QUEUE_URL})

@app.route("/mobile")
def mobile_remote():
    return render_template("mobile.html")

if __name__ == "__main__":
    app.run(debug=True, port=5000)
