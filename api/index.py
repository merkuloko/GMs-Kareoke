from dotenv import load_dotenv

load_dotenv()

"""
Karaoke Web Application Backend (Flask)

This module serves as the main entry point of the Karaoke system. It defines
all HTTP routes, integrates external services, and manages data flow between
the frontend and storage layers.

Core Responsibilities:
- Handle API endpoints for songs, leaderboard, and live queue
- Integrate with Supabase (primary cloud database) and SQLite (fallback/local)
- Process YouTube search requests via YouTube Data API
- Manage mobile queue interactions and QR generation
- Normalize and validate incoming/outgoing data
"""

import hashlib
import json
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from urllib.parse import quote_plus, urlparse

import requests
from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_cors import CORS


current_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(current_dir)
logger = logging.getLogger(__name__)


def is_debug_enabled():
    return os.environ.get("FLASK_DEBUG", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


app = Flask(
    __name__,
    template_folder=os.path.join(base_dir, "templates"),
    static_folder=os.path.join(base_dir, "static"),
)
app.config["DEBUG"] = is_debug_enabled()
app.config["JSON_SORT_KEYS"] = False
CORS(app)

HTTP_TIMEOUT_SECONDS = 10
DEFAULT_DB_CANDIDATES = ("karaoke.db", "kareoke.db")
SUPABASE_TABLE = os.environ.get("SUPABASE_SONGS_TABLE", "songs")
SUPABASE_LEADERBOARD_TABLE = os.environ.get(
    "SUPABASE_LEADERBOARD_TABLE", "leaderboard_entries"
)
YOUTUBE_API = os.environ.get("YOUTUBE_API", "").strip()
SCORING_ENABLED = os.environ.get("SCORING_ENABLED", "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
MOBILE_QUEUE_URL = os.environ.get("MOBILE_QUEUE_URL", "").strip()


def get_mobile_queue_url():
    configured_url = MOBILE_QUEUE_URL.rstrip("/")
    if not configured_url:
        return ""

    parsed = urlparse(configured_url)
    is_local_target = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    is_vercel_target = parsed.hostname and parsed.hostname.endswith(".vercel.app")

    if configured_url and not is_local_target and not is_vercel_target:
        if parsed.path in {"", "/"}:
            return f"{configured_url}/mobile"
        return configured_url

    if request:
        return f"{request.url_root.rstrip('/')}/mobile"
    return ""


def error_response(message, status=400, **extra):
    payload = {"error": message}
    payload.update(extra)
    return jsonify(payload), status


def get_write_secret():
    return os.environ.get("KARAOKE_WRITE_SECRET", "").strip()


def get_write_cookie_value():
    secret = get_write_secret()
    if not secret:
        return ""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def require_write_secret():
    expected_secret = get_write_secret()
    if not expected_secret:
        return False

    provided_header = request.headers.get("X-Karaoke-Secret", "").strip()
    if secrets.compare_digest(provided_header, expected_secret):
        return True

    provided_cookie = request.cookies.get("karaoke_write_token", "").strip()
    return secrets.compare_digest(provided_cookie, get_write_cookie_value())


def require_write_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not require_write_secret():
            return error_response("Unauthorized", 401)
        return func(*args, **kwargs)

    return wrapper


def require_queue_request_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if get_write_secret() and not require_write_secret():
            return error_response("Unauthorized", 401)
        return func(*args, **kwargs)

    return wrapper


def require_score_submission_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if get_write_secret() and not require_write_secret():
            return error_response("Unauthorized", 401)
        return func(*args, **kwargs)

    return wrapper


def require_configured_write_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if get_write_secret() and not require_write_secret():
            return error_response("Unauthorized", 401)
        return func(*args, **kwargs)

    return wrapper


def get_json_body(required_fields=None):
    payload = request.get_json(silent=True)
    if payload is None:
        raise ValueError("Request body must be valid JSON")
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")

    if required_fields:
        for field in required_fields:
            value = payload.get(field)
            if value is None or (isinstance(value, str) and not value.strip()):
                raise ValueError(f"Missing or empty field: {field}")
    return payload


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
    if not isinstance(song, dict):
        return {}

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
        try:
            return response.json()
        except ValueError as error:
            raise RuntimeError("Supabase returned an invalid response") from error

    return None


def fetch_songs():
    supabase_configured = any(
        os.environ.get(name, "").strip()
        for name in (
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_ANON_KEY",
            "SUPABASE_KEY",
        )
    )
    try:
        credentials = get_supabase_credentials()
        supabase_configured = credentials is not None or supabase_configured
        if supabase_configured:
            data = supabase_request(
                "GET",
                SUPABASE_TABLE,
                "select=id,title,artist,youtube_id,rhythm_map&order=title.asc",
            )
            return [normalize_song(song) for song in data or [] if isinstance(song, dict)]
    except (RuntimeError, requests.RequestException) as error:
        logger.warning("Song catalog request failed; trying local fallback: %s", error)

    try:
        conn = get_db_connection()
    except sqlite3.Error as error:
        logger.warning("Local song database could not be opened: %s", error)
        if supabase_configured:
            raise RuntimeError("Song catalog service unavailable") from error
        return []

    if conn is None:
        if supabase_configured:
            raise RuntimeError("Song catalog service unavailable")
        return []

    try:
        songs = conn.execute(
            "SELECT id, title, artist, youtube_id, rhythm_map FROM songs ORDER BY title ASC"
        ).fetchall()
    except sqlite3.Error as error:
        logger.warning("Local song database query failed: %s", error)
        if supabase_configured:
            raise RuntimeError("Song catalog service unavailable") from error
        return []
    finally:
        conn.close()

    return [normalize_song(dict(row)) for row in songs]


def fetch_song_by_id(song_id):
    try:
        if is_supabase_enabled():
            query = f"select=*&id=eq.{song_id}&limit=1"
            data = supabase_request("GET", SUPABASE_TABLE, query)
            return normalize_song(data[0]) if data else None
    except (RuntimeError, requests.RequestException):
        pass

    conn = get_db_connection()
    if conn is None:
        return None

    song = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    conn.close()
    return normalize_song(dict(song)) if song else None


def fetch_leaderboard():
    try:
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
    except (RuntimeError, requests.RequestException):
        return []


def create_leaderboard_entry(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")

    singer_name = (payload.get("name") or "").strip()[:15] or "Anonymous Singer"
    score = payload.get("score", 0)
    song_title = (payload.get("song_title") or "").strip() or "Karaoke Song"

    try:
        score = int(score)
    except (TypeError, ValueError) as error:
        raise ValueError("Score must be a number") from error

    if score < 0:
        raise ValueError("Score must be zero or greater")

    if not is_supabase_enabled():
        raise RuntimeError("Supabase is not configured")

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

    try:
        return supabase_request(
            "DELETE",
            SUPABASE_LEADERBOARD_TABLE,
            "id=gt.0",
            prefer="return=minimal",
        )
    except (RuntimeError, requests.RequestException):
        return None


@app.route("/")
def home():
    response = app.make_response(
        render_template(
            "index.html",
            mobile_queue_url=MOBILE_QUEUE_URL,
            mobile_queue_enabled=bool(MOBILE_QUEUE_URL),
        )
    )
    if get_write_secret():
        response.set_cookie(
            "karaoke_write_token",
            get_write_cookie_value(),
            httponly=True,
            samesite="Lax",
            secure=not app.config["DEBUG"] and request.is_secure,
            path="/",
        )
    return response


@app.route("/favicon.ico")
@app.route("/apple-touch-icon.png")
@app.route("/apple-touch-icon-precomposed.png")
def app_icon():
    return send_from_directory(app.static_folder, "standby.png", mimetype="image/png")


@app.route("/api/live-queue/reorder", methods=["PATCH"])
@require_configured_write_auth
def reorder_live_queue():
    try:
        data = get_json_body(["item_ids"])
    except ValueError as exc:
        return error_response(str(exc), 400)

    item_ids = data["item_ids"]
    if not isinstance(item_ids, list) or not item_ids:
        return error_response("item_ids must be a non-empty list", 400)

    try:
        normalized_ids = [int(item_id) for item_id in item_ids]
    except (TypeError, ValueError):
        return error_response("item_ids must contain integers", 400)

    if len(set(normalized_ids)) != len(normalized_ids):
        return error_response("item_ids must not contain duplicates", 400)

    try:
        start_time = datetime.now(timezone.utc)
        for index, item_id in enumerate(normalized_ids):
            supabase_request(
                "PATCH",
                "live_queue",
                query_string=f"id=eq.{item_id}",
                payload={
                    "created_at": (start_time + timedelta(milliseconds=index)).isoformat()
                },
                prefer="return=minimal",
            )
        return jsonify({"message": "Queue reordered"}), 200
    except RuntimeError as exc:
        return error_response(str(exc), 503)
    except requests.RequestException:
        return error_response("Queue service unavailable", 503)
    except Exception as exc:
        logger.exception("Unable to reorder queue")
        return error_response(f"Unable to reorder queue: {exc}", 500)


@app.route("/api/live-queue/<item_id>", methods=["DELETE", "PATCH"])
@require_configured_write_auth
def manage_queue_item(item_id):
    try:
        item_id = int(item_id)
    except (TypeError, ValueError):
        return error_response("Invalid queue item id", 400)

    try:
        if request.method == "DELETE":
            supabase_request(
                "DELETE",
                "live_queue",
                query_string=f"id=eq.{item_id}",
                prefer="return=minimal",
            )
            return jsonify({"message": "Queue item removed"}), 200

        supabase_request(
            "PATCH",
            "live_queue",
            query_string=f"id=eq.{item_id}",
            payload={"is_played": True},
        )
        return jsonify({"message": "Success"}), 200
    except RuntimeError as exc:
        return error_response(str(exc), 503)
    except requests.RequestException:
        return error_response("Queue service unavailable", 503)
    except Exception as exc:
        return error_response(f"Unable to update queue item: {exc}", 500)


@app.route("/mobile")
def mobile_queue():
    response = app.make_response(render_template("mobile.html"))
    if get_write_secret():
        response.set_cookie(
            "karaoke_write_token",
            get_write_cookie_value(),
            httponly=True,
            samesite="Lax",
            secure=not app.config["DEBUG"] and request.is_secure,
            path="/",
        )
    return response


@app.route("/api/config")
def get_config():
    return jsonify(
        {
            "supabase_enabled": is_supabase_enabled(),
            "mobile_queue_url": MOBILE_QUEUE_URL,
            "mobile_queue_enabled": bool(MOBILE_QUEUE_URL),
            "songs_backend": "supabase" if is_supabase_enabled() else "sqlite",
            "youtube_configured": bool(YOUTUBE_API),
            "scoring_enabled": SCORING_ENABLED,
            "write_auth_required": bool(get_write_secret()),
        }
    )


@app.route("/api/songs")
def get_songs():
    try:
        songs = fetch_songs()
    except RuntimeError:
        return error_response("Song catalog service unavailable", 503)
    except requests.RequestException:
        return error_response("Song catalog service unavailable", 503)
    except sqlite3.Error:
        return error_response("Song catalog service unavailable", 503)

    return jsonify(
        [
            {
                "id": song.get("id"),
                "title": song.get("title", "Untitled song"),
                "artist": song.get("artist", ""),
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
        return error_response(str(error), 500)
    except requests.RequestException:
        return error_response("Song service unavailable", 502)

    if song is None:
        return error_response("Song not found", 404)

    return jsonify(song)


def search_catalog(query):
    normalized_query = query.casefold()
    results = []
    for song in fetch_songs():
        title = str(song.get("title") or "Untitled song")
        artist = str(song.get("artist") or "")
        video_id = str(song.get("youtube_id") or "").strip()
        if video_id and normalized_query in f"{title} {artist}".casefold():
            results.append(
                {
                    "id": video_id,
                    "title": title,
                    "thumbnail": f"https://i.ytimg.com/vi/{quote_plus(video_id)}/mqdefault.jpg",
                }
            )
    return results[:5]


@app.route("/api/search")
def search_youtube():
    query = (request.args.get("q") or "").strip()
    if not query:
        return error_response("No query provided", 400)

    if not YOUTUBE_API:
        try:
            results = search_catalog(query)
            if not results:
                return error_response(
                    "No matching catalog songs found. Configure YOUTUBE_API "
                    "for live YouTube search.",
                    503,
                )
            return jsonify(results)
        except (RuntimeError, requests.RequestException, sqlite3.Error):
            return error_response("Song catalog service unavailable", 503)

    params = {
        "part": "snippet",
        "q": f"{query} karaoke",
        "type": "video",
        "maxResults": 5,
        "key": YOUTUBE_API,
    }

    try:
        response = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException:
        return error_response("YouTube API failed", 502)

    try:
        data = response.json()
    except ValueError:
        logger.warning("YouTube search returned malformed JSON with status %s", response.status_code)
        return error_response("YouTube API returned an invalid response", 502)

    if not isinstance(data, dict):
        return error_response("YouTube API returned an invalid response", 502)

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


@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    try:
        return jsonify(fetch_leaderboard())
    except RuntimeError as error:
        return error_response(str(error), 500)
    except requests.RequestException:
        return error_response("Leaderboard service unavailable", 502)


@app.route("/api/leaderboard", methods=["POST"])
@require_score_submission_auth
def save_score():
    try:
        data = get_json_body()
    except ValueError as exc:
        return error_response(str(exc), 400)

    try:
        entry = create_leaderboard_entry(data)
    except ValueError as error:
        return error_response(str(error), 400)
    except RuntimeError as error:
        return error_response(str(error), 500)
    except requests.RequestException:
        return error_response("Leaderboard service unavailable", 502)

    return jsonify(entry), 201


@app.route("/api/leaderboard", methods=["DELETE"])
@require_configured_write_auth
def delete_leaderboard():
    try:
        clear_leaderboard()
    except RuntimeError as error:
        return error_response(str(error), 500)
    except requests.RequestException:
        return error_response("Leaderboard service unavailable", 502)

    return jsonify({"status": "cleared"})


@app.route("/api/queue-qr")
def queue_qr():
    mobile_queue_url = get_mobile_queue_url()
    if not mobile_queue_url:
        return error_response("Mobile queue URL not configured", 404)

    qr_url = (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=110x110&data={quote_plus(mobile_queue_url)}&bgcolor=0f0f0f&color=00e5b0"
    )
    return jsonify({"url": qr_url, "target": mobile_queue_url})


@app.route("/api/live-queue", methods=["GET"])
def get_live_queue():
    try:
        if not is_supabase_enabled():
            return jsonify([])

        data = supabase_request(
            "GET",
            "live_queue",
            "select=id,youtube_id,title,singer_name,created_at&order=created_at.asc,id.asc",
        )
        return jsonify(
            [
                {
                    "id": item.get("id"),
                    "db_id": item.get("id"),
                    "youtube_id": item.get("youtube_id"),
                    "title": item.get("title", "Untitled song"),
                    "singer_name": item.get("singer_name", "Guest"),
                    "created_at": item.get("created_at"),
                }
                for item in data or []
            ]
        )
    except (RuntimeError, requests.RequestException):
        return error_response("Queue service unavailable", 503)


@app.route("/api/live-queue", methods=["POST"])
@require_queue_request_auth
def add_to_queue():
    try:
        data = get_json_body(["youtube_id", "title", "singer_name"])
    except ValueError as exc:
        return error_response(str(exc), 400)

    video_id = str(data["youtube_id"]).strip()
    title = str(data["title"]).strip()
    singer_name = str(data["singer_name"]).strip()

    if not video_id or not title or not singer_name:
        return error_response("Missing song details", 400)
    if len(video_id) > 100 or len(title) > 300 or len(singer_name) > 100:
        return error_response("Song details are too long", 400)

    try:
        supabase_request(
            "POST",
            "live_queue",
            payload={
                "youtube_id": video_id,
                "title": title,
                "singer_name": singer_name,
            },
            prefer="return=minimal",
        )
        return jsonify({"message": "Success"}), 200
    except RuntimeError:
        return error_response("Queue service is not configured", 503)
    except requests.RequestException:
        return error_response("Queue service unavailable", 503)
    except Exception:
        logger.exception("Unable to add song to queue")
        return error_response("Unable to add song to queue", 500)


@app.route("/api/live-queue", methods=["DELETE"])
@require_configured_write_auth
def clear_live_queue():
    try:
        if not is_supabase_enabled():
            return jsonify({"message": "Queue cleared"}), 200
        supabase_request(
            "DELETE",
            "live_queue",
            query_string="id=gt.0",
            prefer="return=minimal",
        )
        return jsonify({"message": "Queue cleared"}), 200
    except RuntimeError as exc:
        return error_response(str(exc), 503)
    except requests.RequestException:
        return error_response("Queue service unavailable", 503)
    except Exception as exc:
        return error_response(f"Unable to clear queue: {exc}", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=app.config["DEBUG"])
