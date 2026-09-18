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

    def test_idle_add_starts_song_immediately(self):
        self.assertIn("const playerIsIdle = !currentSongRef.current.id && !isPlaying;", UI_SOURCE)
        self.assertIn("playerRef.current.loadVideoById({ videoId: normalized.id, startSeconds: 0 });", UI_SOURCE)
        self.assertIn("setIsPlaying(true);", UI_SOURCE)

    def test_onboarding_requires_device_selection_and_tv_disables_scoring_controls(self):
        self.assertIn("const [deviceType, setDeviceType] = useState(null);", UI_SOURCE)
        self.assertIn("How are you using GM's Karaoke today?", UI_SOURCE)
        self.assertIn("window.location.href = '/mobile'", UI_SOURCE)
        self.assertIn("deviceType === 'tv'", UI_SOURCE)
        self.assertIn("deviceType !== 'tv'", UI_SOURCE)
        self.assertIn("if (deviceType !== 'tv' && typeof config.scoring_enabled === 'boolean')", UI_SOURCE)

    def test_empty_song_does_not_create_youtube_video(self):
        self.assertIn("style: currentSong.id ? undefined : { display: 'none' }", UI_SOURCE)

    def test_tv_hides_search_panel_and_expands_queue_layout(self):
        self.assertIn("deviceType !== 'tv' && React.createElement(", UI_SOURCE)
        self.assertIn("deviceType === 'tv' ? 'search-and-queue tv-queue-only' : 'search-and-queue'", UI_SOURCE)


if __name__ == "__main__":
    unittest.main()
