import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_SOURCE = (ROOT / "static" / "react-ui.js").read_text(encoding="utf-8")


class ReactUiContractTests(unittest.TestCase):
    def test_starts_without_hardcoded_standby_song(self):
        self.assertIn("id: ''", UI_SOURCE)
        self.assertIn("title: ''", UI_SOURCE)
        self.assertNotIn("setCurrentSong(normalizedSongs[0])", UI_SOURCE)

    def test_completion_advances_player_and_removes_next_queue_item(self):
        self.assertIn("loadVideoById({ videoId: next.id, startSeconds: 0 })", UI_SOURCE)
        self.assertIn("method: 'DELETE'", UI_SOURCE)
        self.assertIn("roomUrl(`/api/live-queue/${encodeURIComponent(next.db_id)}`, roomId)", UI_SOURCE)

    def test_empty_song_does_not_create_youtube_video(self):
        self.assertIn("style: currentSong.id ? undefined : { display: 'none' }", UI_SOURCE)


if __name__ == "__main__":
    unittest.main()
