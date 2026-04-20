const RMS_THRESHOLD = 0.018;
const SCORE_INCREMENT = 1;
const SCORE_FORMAT = { minimumIntegerDigits: 6, useGrouping: false };

let currentVideoId = "BhSZGUXeY6Q";
let currentRhythmMap = [];
let currentSongTitle = "Karaoke Song";
let songQueue = [];
let leaderboardData = [];

let player;
let playerReady = false;
let pendingAutoplay = false;
let audioCtx;
let analyser;
let dataArray;
let stream;
let rafId;
let isPlaying = false;
let micActive = false;
let isSinging = false;
let score = 0;
let duration = 0;

const els = {
  loader: document.getElementById("player-loader"),
  standbyImg: document.getElementById("player-standby-img"),
  scoreValue: document.getElementById("score-value"),
  scoreHint: document.getElementById("score-hint"),
  micBtn: document.getElementById("mic-btn"),
  resetBtn: document.getElementById("reset-btn"),
  nextBtn: document.getElementById("next-btn"),
  micDot: document.getElementById("mic-dot"),
  micLabel: document.getElementById("mic-label"),
  singPill: document.getElementById("sing-pill"),
  singLabel: document.getElementById("sing-label"),
  playerFrame: document.getElementById("player-frame"),
  errorMsg: document.getElementById("error-msg"),
  vuMeter: document.getElementById("vu-meter"),
  timelineProgress: document.getElementById("timeline-progress"),
  beatZonesContainer: document.getElementById("beat-zones-container"),
  legendGrid: document.getElementById("legend-grid"),
  songSelect: document.getElementById("song-select"),
  searchInput: document.getElementById("search-input"),
  searchBtn: document.getElementById("search-btn"),
  searchResults: document.getElementById("search-results"),
  queueList: document.getElementById("queue-list"),
  infoBtn: document.getElementById("info-btn"),
  modal: document.getElementById("instruction-modal"),
  closeModalBtn: document.getElementById("close-modal"),
  rankList: document.getElementById("rank-list"),
  resetRankBtn: document.getElementById("reset-rank-btn"),
  queueQrImage: document.getElementById("queue-qr-image"),
  queueQrCopy: document.getElementById("queue-qr-copy"),
};

function formatScore(value) {
  return value.toLocaleString("en-US", SCORE_FORMAT);
}

function showError(message) {
  els.errorMsg.textContent = message;
  els.errorMsg.style.display = message ? "block" : "none";
}

function clearError() {
  showError("");
}

function saveState() {
  localStorage.setItem("karaoke_score", String(score));
  localStorage.setItem("karaoke_queue", JSON.stringify(songQueue));
}

function saveLeaderboardFallback() {
  localStorage.setItem("karaoke_leaderboard", JSON.stringify(leaderboardData));
}

function loadState() {
  const savedScore = localStorage.getItem("karaoke_score");
  const savedQueue = localStorage.getItem("karaoke_queue");

  if (savedScore) {
    const parsedScore = parseInt(savedScore, 10);
    if (!Number.isNaN(parsedScore)) score = parsedScore;
  }

  if (savedQueue) {
    try {
      songQueue = JSON.parse(savedQueue);
    } catch (error) {
      songQueue = [];
    }
  }

  els.scoreValue.innerText = formatScore(score);
  updateQueueUI();
}

function loadLeaderboardFallback() {
  const savedLeaderboard = localStorage.getItem("karaoke_leaderboard");
  if (!savedLeaderboard) {
    leaderboardData = [];
    updateLeaderboardUI();
    return;
  }

  try {
    leaderboardData = JSON.parse(savedLeaderboard);
  } catch (error) {
    leaderboardData = [];
  }

  updateLeaderboardUI();
}

async function loadLeaderboard() {
  try {
    leaderboardData = await fetchJson("/api/leaderboard");
    saveLeaderboardFallback();
  } catch (error) {
    loadLeaderboardFallback();
    return;
  }

  updateLeaderboardUI();
}

async function submitLeaderboardScore(scoreData) {
  try {
    await fetchJson("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scoreData),
    });
    await loadLeaderboard();
  } catch (error) {
    try {
      saveLeaderboardFallback();
    } catch (storageError) {
      console.error("Failed to update leaderboard fallback:", storageError);
    }
  }
}

async function clearLeaderboard() {
  try {
    await fetchJson("/api/leaderboard", { method: "DELETE" });
  } catch (error) {
    console.error("Failed to clear remote leaderboard:", error);
  }

  leaderboardData = [];
  saveLeaderboardFallback();
  updateLeaderboardUI();
}

function normalizeSong(song) {
  return {
    id: song.youtube_id || song.id,
    songId: song.id,
    title: song.title || "Untitled",
    artist: song.artist || "",
    rhythm_map: Array.isArray(song.rhythm_map) ? song.rhythm_map : [],
  };
}

function setCurrentSong(song) {
  currentVideoId = song.id;
  currentRhythmMap = Array.isArray(song.rhythm_map) ? song.rhythm_map : [];
  currentSongTitle = song.artist ? `${song.title} - ${song.artist}` : song.title;
  duration = 0;
  els.timelineProgress.style.width = "0%";
  updateRhythmUI();
}

function resetScore() {
  score = 0;
  els.scoreValue.innerText = formatScore(score);
  saveState();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data && data.error ? data.error : "Request failed";
    throw new Error(message);
  }

  return data;
}

async function loadSongMenu() {
  try {
    const songs = await fetchJson("/api/songs");
    songs.forEach((song) => {
      const option = document.createElement("option");
      option.value = song.id;
      option.textContent = `${song.title} - ${song.artist}`;
      els.songSelect.appendChild(option);
    });
  } catch (error) {
    showError(error.message);
  }
}

async function loadQueueQr() {
  const enabled = document.body.dataset.mobileQueueEnabled === "true";
  if (!enabled) return;

  try {
    const qr = await fetchJson("/api/queue-qr");
    els.queueQrImage.src = qr.url;
    els.queueQrImage.style.display = "block";
    els.queueQrCopy.textContent = "Scan to open the mobile queue";
  } catch (error) {
    els.queueQrCopy.textContent = error.message;
  }
}

function renderSearchResult(video) {
  const item = document.createElement("button");
  item.type = "button";
  item.style.display = "flex";
  item.style.alignItems = "center";
  item.style.gap = "10px";
  item.style.padding = "8px";
  item.style.background = "#151515";
  item.style.borderRadius = "4px";
  item.style.cursor = "pointer";
  item.style.border = "1px solid #222";
  item.style.marginBottom = "5px";

  const img = document.createElement("img");
  img.src = video.thumbnail;
  img.alt = "";
  img.style.width = "50px";
  img.style.borderRadius = "3px";

  const text = document.createElement("div");
  text.style.fontSize = "11px";
  text.style.color = "#fff";
  text.textContent = video.title;

  item.appendChild(img);
  item.appendChild(text);
  item.addEventListener("click", () => {
    addToQueue({ id: video.id, title: video.title, rhythm_map: [] });
    els.searchResults.innerHTML = "";
    els.searchInput.value = "";
  });

  return item;
}

async function searchYouTube() {
  const query = els.searchInput.value.trim();
  if (!query) return;

  clearError();
  els.searchResults.innerHTML = '<div style="font-size:12px; color:#555;">Searching...</div>';

  try {
    const results = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
    els.searchResults.innerHTML = "";

    if (results.length === 0) {
      els.searchResults.innerHTML = '<div style="font-size:12px; color:#555;">No results found</div>';
      return;
    }

    results.forEach((video) => {
      els.searchResults.appendChild(renderSearchResult(video));
    });
  } catch (error) {
    els.searchResults.innerHTML = '<div style="color:red">Search failed</div>';
    showError(error.message);
  }
}

function addToQueue(song) {
  songQueue.push(normalizeSong(song));
  updateQueueUI();
  saveState();

  if (!playerReady) {
    pendingAutoplay = true;
    showError("Player is still loading. Your song will start once YouTube is ready.");
    return;
  }

  const state = player.getPlayerState();
  if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.ENDED || state === YT.PlayerState.CUED) {
    playNextInQueue();
  }
}

function playVideo(videoId) {
  if (!playerReady || !player || !player.loadVideoById) {
    pendingAutoplay = true;
    return;
  }

  player.loadVideoById({
    videoId,
    startSeconds: 0,
  });
}

function playNextInQueue() {
  if (songQueue.length === 0) {
    pendingAutoplay = false;
    return;
  }

  const nextSong = songQueue.shift();
  setCurrentSong(nextSong);
  playVideo(currentVideoId);
  updateQueueUI();
  saveState();
}

function updateQueueUI() {
  els.queueList.innerHTML = "";

  if (songQueue.length === 0) {
    els.queueList.innerHTML = '<div style="font-size: 12px; color: #555;">Queue is empty</div>';
    return;
  }

  songQueue.forEach((song, index) => {
    const div = document.createElement("div");
    div.style.fontSize = "11px";
    div.style.padding = "5px";
    div.style.background = "#1a1a1a";
    div.style.borderRadius = "3px";
    div.style.marginBottom = "5px";
    div.style.color = "#eee";

    const singer = song.requestor ? ` [${song.requestor}]` : "";

    div.textContent = `${index + 1}. ${song.title}${singer}`;

    els.queueList.appendChild(div);
  });
}

function updateRhythmUI() {
  els.legendGrid.innerHTML = "";

  if (currentRhythmMap.length === 0) {
    els.legendGrid.innerHTML = '<div style="color:#00e5b0; border: 1px solid #00e5b044; padding: 10px; background: #00e5b011; border-radius: 4px;">Free-for-All Mode</div>';
    buildTimelineZones();
    return;
  }

  currentRhythmMap.forEach((zone) => {
    const chip = document.createElement("div");
    chip.className = "legend-chip";

    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = zone.label;

    const time = document.createElement("span");
    time.className = "chip-time";
    time.textContent = `${zone.start}s - ${zone.end}s`;

    chip.appendChild(label);
    chip.appendChild(time);
    els.legendGrid.appendChild(chip);
  });

  buildTimelineZones();
}

function initUI() {
  for (let i = 0; i < 18; i += 1) {
    const bar = document.createElement("div");
    bar.className = "vu-bar";
    els.vuMeter.appendChild(bar);
  }
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  player = new YT.Player("yt-player-container", {
    videoId: "",
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: (event) => {
        playerReady = true;
        duration = event.target.getDuration();
        buildTimelineZones();
        clearError();

        if (pendingAutoplay && songQueue.length > 0) {
          pendingAutoplay = false;
          playNextInQueue();
        }
      },
      onStateChange: (event) => {
        isPlaying = event.data === YT.PlayerState.PLAYING;
        if (isPlaying) {
          els.loader.style.display = "none";
          els.standbyImg.style.display = "none";
          duration = event.target.getDuration();
          if (micActive) startLoop();
        } else {
          cancelAnimationFrame(rafId);
        }

        if (event.data === YT.PlayerState.ENDED) {
          if (score > 0) {
            let singerName = prompt(`Great job! Your score was ${score}.\nEnter your name for the leaderboard:`) || "Anonymous Singer";
            singerName = singerName.trim() || "Anonymous Singer";

            const scoreData = {
              name: singerName.substring(0, 15),
              score,
              song_title: currentSongTitle,
            };

            leaderboardData.push(scoreData);
            updateLeaderboardUI();
            saveLeaderboardFallback();
            void submitLeaderboardScore(scoreData);
            resetScore();
          }

          playNextInQueue();
        }

        updateHint();
      },
    },
  });
};

function buildTimelineZones() {
  if (!duration) return;

  els.beatZonesContainer.innerHTML = "";
  currentRhythmMap.forEach((zone, index) => {
    const div = document.createElement("div");
    div.className = "beat-zone";
    div.id = `zone-${index}`;
    div.style.left = `${(zone.start / duration) * 100}%`;
    div.style.width = `${((zone.end - zone.start) / duration) * 100}%`;
    els.beatZonesContainer.appendChild(div);
  });
}

function getRMS(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const norm = data[i] / 128 - 1;
    sum += norm * norm;
  }
  return Math.sqrt(sum / data.length);
}

function startLoop() {
  cancelAnimationFrame(rafId);

  function loop() {
    if (!isPlaying || !micActive || !analyser) return;

    analyser.getByteTimeDomainData(dataArray);
    const rms = getRMS(dataArray);
    isSinging = rms > RMS_THRESHOLD;
    const currentTime = player.getCurrentTime() || 0;
    if (duration) {
      els.timelineProgress.style.width = `${(currentTime / duration) * 100}%`;
    }

    let onBeat = currentRhythmMap.length === 0;
    currentRhythmMap.forEach((zone, index) => {
      const zoneEl = document.getElementById(`zone-${index}`);
      const inZone = currentTime >= zone.start && currentTime <= zone.end;
      if (inZone) onBeat = true;
      if (zoneEl) zoneEl.classList.toggle("current", inZone);
    });

    if (onBeat && isSinging) {
      score += SCORE_INCREMENT;
      els.scoreValue.innerText = formatScore(score);
      saveState();
    }

    updateVUUI(rms);
    updateSingingUI();
    updateHint();
    rafId = requestAnimationFrame(loop);
  }

  loop();
}

function updateSingingUI() {
  els.singPill.classList.toggle("active", isSinging);
  els.playerFrame.classList.toggle("singing", isSinging);
  els.singLabel.innerText = isSinging ? "SINGING" : "SILENT";
}

function updateVUUI(rms) {
  const level = Math.min(1, rms / 0.08);
  const bars = els.vuMeter.children;
  for (let i = 0; i < bars.length; i += 1) {
    const ratio = i / bars.length;
    const active = level > ratio;
    bars[i].style.background = active ? (ratio > 0.75 ? "#ff4060" : ratio > 0.5 ? "#f5c842" : "#00e5b0") : "#1a1a1a";
  }
}

function updateHint() {
  if (!micActive) {
    els.scoreHint.innerText = "Enable mic to start scoring";
    return;
  }

  if (!isPlaying) {
    els.scoreHint.innerText = "Press play to begin";
    return;
  }

  els.scoreHint.innerText = isSinging ? "Keep singing!" : (currentRhythmMap.length === 0 ? "Sing anytime!" : "Sing on the teal zones");
}

async function toggleMic() {
  if (micActive) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (audioCtx && audioCtx.state !== "closed") await audioCtx.close();
    micActive = false;
    els.micBtn.innerText = "ENABLE MIC";
    els.micBtn.className = "btn btn-start";
    els.micDot.classList.remove("active");
    els.micLabel.innerText = "NO MIC";
    isSinging = false;
    updateSingingUI();
    updateHint();
    return;
  }

  try {
    audioCtx = new AudioContext();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.fftSize);
    micActive = true;
    els.micBtn.innerText = "STOP MIC";
    els.micBtn.className = "btn btn-stop";
    els.micDot.classList.add("active");
    els.micLabel.innerText = "MIC";
    clearError();
    if (isPlaying) startLoop();
    updateHint();
  } catch (error) {
    showError("Microphone access denied");
  }
}


function updateLeaderboardUI() {
  els.rankList.innerHTML = "";
  if (leaderboardData.length === 0) {
    els.rankList.innerHTML = '<div style="font-size: 12px; color: #555;">No scores yet</div>';
    return;
  }

  leaderboardData.sort((a, b) => b.score - a.score);
  leaderboardData.slice(0, 5).forEach((entry, index) => {
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.fontSize = "11px";
    div.style.padding = "5px";
    div.style.background = "#1a1a1a";
    div.style.borderRadius = "3px";
    div.style.color = "#eee";

    const left = document.createElement("span");

    const rank = document.createElement("strong");
    rank.style.marginRight = "6px";
    rank.style.color = index === 0 ? "#f5c842" : (index === 1 ? "#c0c0c0" : (index === 2 ? "#cd7f32" : "#888"));
    rank.textContent = `#${index + 1}`;

    // Create a separate span for the name to keep it safe
    const nameSpan = document.createElement("span");
    nameSpan.textContent = ` ${entry.name}`; // SAFE: Sanitize name

    left.appendChild(rank);
    left.appendChild(nameSpan);

    const right = document.createElement("span");
    right.style.fontFamily = "'Space Mono', monospace";
    right.style.color = "#00e5b0";
    right.textContent = formatScore(entry.score);

    div.appendChild(left);
    div.appendChild(right);
    els.rankList.appendChild(div);
  });
}

els.songSelect.addEventListener("change", async (event) => {
  const songId = event.target.value;
  if (!songId) return;

  try {
    const songData = await fetchJson(`/api/songs/${songId}`);
    songQueue = [];
    updateQueueUI();
    setCurrentSong(normalizeSong(songData));
    playVideo(currentVideoId);
    saveState();
    clearError();
  } catch (error) {
    showError(error.message);
  }
});

els.searchBtn.addEventListener("click", searchYouTube);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchYouTube();
  }
});
els.micBtn.addEventListener("click", toggleMic);
els.resetBtn.addEventListener("click", () => {
  resetScore();
  clearError();
});
els.nextBtn.addEventListener("click", () => {
  cancelAnimationFrame(rafId);
  els.beatZonesContainer.innerHTML = "";
  els.timelineProgress.style.width = "0%";

  if (songQueue.length > 0) {
    playNextInQueue();
    clearError();
    return;
  }

  if (playerReady) player.stopVideo();
  els.loader.style.display = "flex";
  els.standbyImg.style.display = "block";
  currentRhythmMap = [];
  updateRhythmUI();
  showError("Queue is empty. Search for a song.");
});

els.infoBtn.addEventListener("click", () => {
  els.modal.style.display = "flex";
});
els.closeModalBtn.addEventListener("click", () => {
  els.modal.style.display = "none";
});
window.addEventListener("click", (event) => {
  if (event.target === els.modal) {
    els.modal.style.display = "none";
  }
});
els.resetRankBtn.addEventListener("click", () => {
  void clearLeaderboard();
});

async function initRealtimeQueue() {
    try {
        const config = await fetch('/api/config').then(res => res.json());

        if (!config.supabase_url || !config.supabase_key) {
            console.warn("Supabase credentials missing from config.");
            return;
        }

        const _supabase = supabase.createClient(config.supabase_url, config.supabase_key);

        _supabase
            .channel('public:live_queue')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'live_queue'
            }, payload => {
                addToQueue({
                    id: payload.new.youtube_id,
                    title: `${payload.new.title} (Requested by: ${payload.new.singer_name})`,
                    rhythm_map: []
                });
            })
            .subscribe();

        console.log("Secure Realtime Bridge Active.");
    } catch (err) {
        console.error("Failed to initialize secure bridge:", err);
    }
}
initRealtimeQueue();
loadState();
initUI();
updateRhythmUI();
updateHint();
loadSongMenu();
loadLeaderboard();
loadQueueQr();
