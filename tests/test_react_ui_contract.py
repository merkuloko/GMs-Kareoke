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
        self.assertIn("const [deviceType, setDeviceType] = useState(() =>", UI_SOURCE)
        self.assertIn("How are you using GM's Karaoke today?", UI_SOURCE)
        self.assertIn("onClick: () => setGuestEntry(true)", UI_SOURCE)
        self.assertIn("deviceType === 'tv'", UI_SOURCE)
        self.assertIn("deviceType !== 'tv'", UI_SOURCE)
        self.assertIn("if (deviceType !== 'tv' && typeof config.scoring_enabled === 'boolean')", UI_SOURCE)

    def test_empty_song_does_not_create_youtube_video(self):
        self.assertIn("style: currentSong.id ? undefined : { display: 'none' }", UI_SOURCE)

    def test_tv_hides_search_panel_and_expands_queue_layout(self):
        self.assertIn("deviceType !== 'tv' && React.createElement(", UI_SOURCE)
        self.assertIn("deviceType === 'tv' ? 'search-and-queue tv-queue-only' : 'search-and-queue'", UI_SOURCE)

    def test_polled_song_autoplays_when_player_is_idle(self):
        self.assertIn("const fetchedQueue = waitingItems.map((item) => normalizeSong({", UI_SOURCE)
        self.assertIn("if (!currentSongRef.current.id && !isPlaying && fetchedQueue.length > 0)", UI_SOURCE)
        self.assertIn("setCurrentSong(nextSong);", UI_SOURCE)
        self.assertIn("playerRef.current.loadVideoById({ videoId: nextSong.id, startSeconds: 0 });", UI_SOURCE)
        self.assertIn("roomUrl(`/api/live-queue/${encodeURIComponent(nextSong.db_id)}`, roomId)", UI_SOURCE)

    def test_session_persists_and_onboarding_creates_or_resumes_sessions(self):
        self.assertIn("const [roomId, setRoomId] = useState(() => window.localStorage.getItem(roomStorageKey) || '');", UI_SOURCE)
        self.assertIn("const [deviceType, setDeviceType] = useState(() => window.localStorage.getItem('karaoke_device_type') || null);", UI_SOURCE)
        self.assertIn("const [sessionActive, setSessionActive] = useState(() => Boolean(window.localStorage.getItem(roomStorageKey)));", UI_SOURCE)
        self.assertIn("function enterSession(id, device) {", UI_SOURCE)
        self.assertIn("window.localStorage.setItem('karaoke_device_type', device);", UI_SOURCE)
        self.assertIn("const [resumeCodeInput, setResumeCodeInput] = useState('');", UI_SOURCE)
        self.assertIn("Create New Session", UI_SOURCE)
        self.assertNotIn("Your room code ", UI_SOURCE)
        self.assertIn("function leaveSession() {", UI_SOURCE)
        self.assertIn("window.localStorage.removeItem(roomStorageKey);", UI_SOURCE)
        self.assertIn("onClick: leaveSession", UI_SOURCE)

    def test_guest_entry_requires_and_routes_room_code(self):
        self.assertIn("const [guestEntry, setGuestEntry] = useState(false);", UI_SOURCE)
        self.assertIn("const [guestCodeInput, setGuestCodeInput] = useState('');", UI_SOURCE)
        self.assertIn("onClick: () => setGuestEntry(true)", UI_SOURCE)
        self.assertIn("Join a Karaoke Room", UI_SOURCE)
        self.assertIn("setGuestEntry(false)", UI_SOURCE)
        self.assertIn("window.location.href = '/join/' + guestCodeInput.toUpperCase();", UI_SOURCE)

    def test_player_skips_restricted_videos(self):
        self.assertIn("const onPlayerError = (event) => {", UI_SOURCE)
        self.assertIn("[101, 150, 15, 100].includes(event.data)", UI_SOURCE)
        self.assertIn("Video restricted by owner. Skipping to next song...", UI_SOURCE)
        self.assertIn("advanceAfterCompletion();", UI_SOURCE)
        self.assertIn("onError: onPlayerError", UI_SOURCE)


if __name__ == "__main__":
    unittest.main()
