import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("KARAOKE_WRITE_SECRET", "test-secret")
os.environ.setdefault("MOBILE_QUEUE_URL", "https://example.com/mobile")
os.environ.setdefault("YOUTUBE_API_KEY", "")
os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_ANON_KEY", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

import api.index as api


class ApiEndpointTests(unittest.TestCase):
    def setUp(self):
        api.app.config["TESTING"] = True
        self.client = api.app.test_client()
        self.headers = {"X-Karaoke-Secret": os.environ["KARAOKE_WRITE_SECRET"]}

    def test_invalid_queue_request_missing_json(self):
        response = self.client.post(
            "/api/live-queue",
            data="not-json",
            content_type="application/json",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("valid JSON", response.get_json()["error"])

    def test_invalid_queue_request_missing_fields(self):
        response = self.client.post(
            "/api/live-queue",
            json={"youtube_id": "abc123"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing or empty field: title", response.get_json()["error"])

    def test_valid_queue_request(self):
        with patch.object(api, "supabase_request", return_value={"ok": True}) as mock_request:
            response = self.client.post(
                "/api/live-queue",
                json={
                    "youtube_id": "abc123",
                    "title": "Take On Me",
                    "singer_name": "Jamie",
                },
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["message"], "Success")
        mock_request.assert_called_once()

    def test_queue_delete_requires_secret(self):
        response = self.client.delete("/api/live-queue")
        self.assertEqual(response.status_code, 401)

    def test_queue_delete_success(self):
        with patch.object(api, "supabase_request", return_value=None):
            response = self.client.delete("/api/live-queue", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["message"], "Queue cleared")

    def test_invalid_leaderboard_request(self):
        response = self.client.post(
            "/api/leaderboard",
            json={"score": "NaN"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Score must be a number", response.get_json()["error"])

    def test_invalid_score(self):
        response = self.client.post(
            "/api/leaderboard",
            json={"score": -5, "name": "Jamie", "song_title": "Song"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("zero or greater", response.get_json()["error"])

    def test_missing_youtube_api_key(self):
        original = api.YOUTUBE_API_KEY
        api.YOUTUBE_API_KEY = ""
        try:
            response = self.client.get("/api/search?q=test")
        finally:
            api.YOUTUBE_API_KEY = original
        self.assertEqual(response.status_code, 503)
        self.assertIn("not configured", response.get_json()["error"])

    def test_database_failure_returns_empty_list(self):
        temp_dir = Path(__file__).resolve().parent
        missing_db = temp_dir / "missing-karaoke.db"
        original = os.environ.get("KARAOKE_DB_PATH")
        os.environ["KARAOKE_DB_PATH"] = str(missing_db)
        try:
            self.assertEqual(api.fetch_songs(), [])
            self.assertIsNone(api.get_db_connection())
        finally:
            if original is None:
                os.environ.pop("KARAOKE_DB_PATH", None)
            else:
                os.environ["KARAOKE_DB_PATH"] = original

    def test_songs_upstream_failure_returns_safe_service_error(self):
        with patch.object(
            api,
            "get_supabase_credentials",
            return_value={"url": "https://example.supabase.co", "key": "test-key"},
        ), patch.object(
            api,
            "supabase_request",
            side_effect=api.requests.RequestException("upstream unavailable"),
        ), patch.object(api, "get_db_connection", return_value=None):
            response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"error": "Song catalog service unavailable"},
        )

    def test_songs_database_failure_returns_safe_service_error(self):
        with patch.object(
            api,
            "get_supabase_credentials",
            return_value={"url": "https://example.supabase.co", "key": "test-key"},
        ), patch.object(api, "get_db_connection", side_effect=api.sqlite3.OperationalError):
            response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"error": "Song catalog service unavailable"},
        )

    def test_songs_invalid_supabase_configuration_returns_safe_service_error(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_ANON_KEY": "",
                "SUPABASE_SERVICE_ROLE_KEY": "",
                "SUPABASE_KEY": "",
            },
            clear=False,
        ), patch.object(api, "get_db_connection", return_value=None):
            response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"error": "Song catalog service unavailable"},
        )

    def test_malformed_youtube_response_returns_safe_error(self):
        class MalformedResponse:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                raise ValueError("not json")

        original = api.YOUTUBE_API_KEY
        api.YOUTUBE_API_KEY = "test-key"
        try:
            with patch("api.index.requests.get", return_value=MalformedResponse()):
                response = self.client.get("/api/search?q=test")
        finally:
            api.YOUTUBE_API_KEY = original

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.get_json(),
            {"error": "YouTube API returned an invalid response"},
        )

    def test_malformed_song_rows_are_normalized(self):
        with patch.object(
            api,
            "get_supabase_credentials",
            return_value={"url": "https://example.supabase.co", "key": "test-key"},
        ), patch.object(
            api,
            "supabase_request",
            return_value=[{"id": 7}, "not-a-song"],
        ):
            response = self.client.get("/api/songs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            [
                {
                    "id": 7,
                    "title": "Untitled song",
                    "artist": "",
                    "youtube_id": None,
                    "rhythm_map": [],
                }
            ],
        )

    def test_static_application_assets_are_available(self):
        for path in (
            "/static/standby.png",
            "/favicon.ico",
            "/apple-touch-icon.png",
            "/apple-touch-icon-precomposed.png",
        ):
            with self.subTest(path=path):
                with self.client.get(path) as response:
                    self.assertEqual(response.status_code, 200)

    def test_queue_read_returns_json(self):
        response = self.client.get("/api/live-queue")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [])

    def test_unauthorized_write_request(self):
        response = self.client.post(
            "/api/leaderboard",
            json={"name": "Jamie", "score": 99, "song_title": "Song"},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
