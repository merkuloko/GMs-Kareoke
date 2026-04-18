// ─── Config & State ─────────────────────────────────────
const RMS_THRESHOLD = 0.018;
const SCORE_INCREMENT = 1;

let currentVideoId = 'BhSZGUXeY6Q'; // Starting video
let currentRhythmMap = [];
let songQueue = []; // Holds the "Up Next" songs
let leaderboardData = [];

let player, audioCtx, analyser, dataArray, stream, rafId;
let isPlaying = false;
let micActive = false;
let isSinging = false;
let score = 0;
let duration = 0;

// ─── DOM Elements ───────────────────────────────────────
const els = {
  loader: document.getElementById('player-loader'),
  standbyImg: document.getElementById('player-standby-img'),
  scoreValue: document.getElementById('score-value'),
  scoreHint: document.getElementById('score-hint'),
  micBtn: document.getElementById('mic-btn'),
  resetBtn: document.getElementById('reset-btn'),
  nextBtn: document.getElementById('next-btn'),
  micDot: document.getElementById('mic-dot'),
  micLabel: document.getElementById('mic-label'),
  singPill: document.getElementById('sing-pill'),
  singLabel: document.getElementById('sing-label'),
  playerFrame: document.getElementById('player-frame'),
  errorMsg: document.getElementById('error-msg'),
  vuMeter: document.getElementById('vu-meter'),
  timelineProgress: document.getElementById('timeline-progress'),
  beatZonesContainer: document.getElementById('beat-zones-container'),
  legendGrid: document.getElementById('legend-grid'),
  songSelect: document.getElementById('song-select'),
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  searchResults: document.getElementById('search-results'),
  queueList: document.getElementById('queue-list'),

  // --- NEW ELEMENTS FOR MODAL & LEADERBOARD ---
  infoBtn: document.getElementById('info-btn'),
  modal: document.getElementById('instruction-modal'),
  closeModalBtn: document.getElementById('close-modal'),
  rankList: document.getElementById('rank-list'),
  resetRankBtn: document.getElementById('reset-rank-btn')
};

// ─── Local Storage (Save State) ─────────────────────────

function saveState() {
    localStorage.setItem('karaoke_score', score);
    localStorage.setItem('karaoke_queue', JSON.stringify(songQueue));
    localStorage.setItem('karaoke_leaderboard', JSON.stringify(leaderboardData));
}

function loadState() {
    const savedScore = localStorage.getItem('karaoke_score');
    const savedQueue = localStorage.getItem('karaoke_queue');
    const savedLeaderboard = localStorage.getItem('karaoke_leaderboard');

    // If saved data exists, load it into our variables
    if (savedScore) score = parseInt(savedScore);
    if (savedQueue) songQueue = JSON.parse(savedQueue);
    if (savedLeaderboard) leaderboardData = JSON.parse(savedLeaderboard);

    // Update the screen with the loaded data
    els.scoreValue.innerText = score.toLocaleString("en-US", { minimumIntegerDigits: 6, useGrouping: false });
    updateQueueUI();
    updateLeaderboardUI();
}

// ─── Menu & Database Logic ──────────────────────────────
async function loadSongMenu() {
    try {
        const response = await fetch('/api/songs');
        const songs = await response.json();
        songs.forEach(song => {
            const option = document.createElement('option');
            option.value = song.id;
            option.textContent = `${song.title} - ${song.artist}`;
            els.songSelect.appendChild(option);
        });
    } catch (err) { console.error("Database load failed", err); }
}

els.songSelect.addEventListener('change', async (e) => {
    const songId = e.target.value;
    if (!songId) return;
    const response = await fetch(`/api/songs/${songId}`);
    const songData = await response.json();

    songQueue = [];
    updateQueueUI();
    currentVideoId = songData.youtube_id;
    currentRhythmMap = songData.rhythm_map;

    if (player && player.loadVideoById) player.loadVideoById(currentVideoId);
    updateRhythmUI();
});

// ─── Search & Queue Logic ───────────────────────────────
els.searchBtn.addEventListener('click', async () => {
    const query = els.searchInput.value;
    if (!query) return;

    els.searchResults.innerHTML = '<div style="font-size:12px; color:#555;">Searching...</div>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await response.json();

        els.searchResults.innerHTML = '';
        results.forEach(video => {
            const div = document.createElement('div');
            div.style = "display: flex; align-items: center; gap: 10px; padding: 8px; background: #151515; border-radius: 4px; cursor: pointer; border: 1px solid #222; margin-bottom: 5px;";
            div.innerHTML = `
                <img src="${video.thumbnail}" style="width: 50px; border-radius: 3px;">
                <div style="font-size: 11px; color: #fff;">${video.title}</div>
            `;
            div.onclick = () => {
                addToQueue({ id: video.id, title: video.title, rhythm_map: [] });
                els.searchResults.innerHTML = '';
                els.searchInput.value = '';
            };
            els.searchResults.appendChild(div);
        });
    } catch (err) { els.searchResults.innerHTML = '<div style="color:red">Search Failed</div>'; }
});

function addToQueue(song) {
    songQueue.push(song);
    updateQueueUI();

    const state = player.getPlayerState();
    if (state === -1 || state === 0 || state === 5) {
        playNextInQueue();
    }
    saveState();
}

function playNextInQueue() {
    if (songQueue.length === 0) return;

    const nextSong = songQueue.shift();
    currentVideoId = nextSong.id;

    if (player && player.loadVideoById) {
        player.loadVideoById({
            videoId: currentVideoId,
            startSeconds: 0
        });
    }
    updateQueueUI();
    saveState();
}

function updateQueueUI() {
    els.queueList.innerHTML = songQueue.length === 0 ? '<div style="font-size: 12px; color: #555;">Queue is empty</div>' : '';
    songQueue.forEach((song, i) => {
        const div = document.createElement('div');
        div.style = "font-size: 11px; padding: 5px; background: #1a1a1a; border-radius: 3px; margin-bottom: 5px; color: #eee;";
        div.innerText = `${i + 1}. ${song.title}`;
        els.queueList.appendChild(div);
    });
}

function updateRhythmUI() {
    els.legendGrid.innerHTML = currentRhythmMap.length === 0 ? '<div style="color:#00e5b0; border: 1px solid #00e5b044; padding: 10px; background: #00e5b011; border-radius: 4px;">Free-for-All Mode</div>' : '';
    currentRhythmMap.forEach(zone => {
        els.legendGrid.innerHTML += `<div class="legend-chip"><span class="chip-label">${zone.label}</span><span class="chip-time">${zone.start}s – ${zone.end}s</span></div>`;
    });
    buildTimelineZones();
}

// ─── UI & YouTube Setup ──────────────────────────────────
function initUI() {
  for(let i = 0; i < 18; i++) {
    const bar = document.createElement('div');
    bar.className = 'vu-bar';
    els.vuMeter.appendChild(bar);
  }
}

window.onYouTubeIframeAPIReady = function() {
  player = new YT.Player('yt-player-container', {
    videoId: '',
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: (e) => {
        duration = e.target.getDuration();
        buildTimelineZones();
      },
      onStateChange: (e) => {
        isPlaying = (e.data === YT.PlayerState.PLAYING);
        if (isPlaying) {
          els.loader.style.display = 'none';
          els.standbyImg.style.display = 'none';
          duration = e.target.getDuration();
          if (micActive) startLoop();
        } else {
          cancelAnimationFrame(rafId);
        }

        if (e.data === YT.PlayerState.ENDED) {
            if (score > 0) {
                let singerName = prompt(`Great job! Your score was ${score}.\nEnter your name for the leaderboard:`) || "Anonymous Singer";
                leaderboardData.push({ name: singerName.substring(0, 15), score: score });
                updateLeaderboardUI();
                score = 0;
                els.scoreValue.innerText = "000000";
                saveState();
            }
            playNextInQueue();
        }

        updateHint();
      }
    } // <-- THESE WERE THE MISSING BRACKETS!
  });
}

function buildTimelineZones() {
  if (!duration) return;
  els.beatZonesContainer.innerHTML = '';
  currentRhythmMap.forEach((zone, i) => {
    const div = document.createElement('div');
    div.className = 'beat-zone';
    div.id = `zone-${i}`;
    div.style.left = `${(zone.start / duration) * 100}%`;
    div.style.width = `${((zone.end - zone.start) / duration) * 100}%`;
    els.beatZonesContainer.appendChild(div);
  });
}

// ─── Scoring & Audio ─────────────────────────────────────
function getRMS(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const norm = data[i] / 128 - 1;
    sum += norm * norm;
  }
  return Math.sqrt(sum / data.length);
}


function startLoop() {
  cancelAnimationFrame(rafId);
  function loop() {
    if (!isPlaying || !micActive) return;
    analyser.getByteTimeDomainData(dataArray);
    const rms = getRMS(dataArray);
    isSinging = rms > RMS_THRESHOLD;
    const currentTime = player.getCurrentTime() || 0;
    if (duration) els.timelineProgress.style.width = `${(currentTime / duration) * 100}%`;

    let onBeat = currentRhythmMap.length === 0;
    currentRhythmMap.forEach((zone, i) => {
      const zoneEl = document.getElementById(`zone-${i}`);
      if (currentTime >= zone.start && currentTime <= zone.end) {
        onBeat = true;
        if(zoneEl) zoneEl.classList.add('current');
      } else if(zoneEl) zoneEl.classList.remove('current');
    });

    if (onBeat && isSinging) {
      score += SCORE_INCREMENT;
      els.scoreValue.innerText = score.toLocaleString("en-US", { minimumIntegerDigits: 6, useGrouping: false });
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
  els.singPill.classList.toggle('active', isSinging);
  els.playerFrame.classList.toggle('singing', isSinging);
  els.singLabel.innerText = isSinging ? "SINGING" : "SILENT";
}

function updateVUUI(rms) {
  const level = Math.min(1, rms / 0.08);
  const bars = els.vuMeter.children;
  for (let i = 0; i < bars.length; i++) {
    const active = level > (i / bars.length);
    bars[i].style.background = active ? (i/bars.length > 0.75 ? "#ff4060" : i/bars.length > 0.5 ? "#f5c842" : "#00e5b0") : "#1a1a1a";
  }
}

function updateHint() {
  if (!micActive) els.scoreHint.innerText = "Enable mic to start scoring";
  else if (!isPlaying) els.scoreHint.innerText = "Press play to begin";
  else els.scoreHint.innerText = isSinging ? "Keep singing!" : (currentRhythmMap.length === 0 ? "Sing anytime!" : "Sing on the teal zones");
}

async function toggleMic() {
  if (micActive) {
    stream.getTracks().forEach(t => t.stop());
    audioCtx.close();
    micActive = false;
    els.micBtn.innerText = "ENABLE MIC";
    els.micBtn.className = "btn btn-start";
    els.micDot.classList.remove('active');
    els.micLabel.innerText = "NO MIC";
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
    els.micDot.classList.add('active');
    els.micLabel.innerText = "MIC";
    if (isPlaying) startLoop();
  } catch (err) { alert("Mic access denied"); }
}

els.micBtn.addEventListener('click', toggleMic);
els.resetBtn.addEventListener('click', () => {
  score = 0;
  els.scoreValue.innerText = "000000";
});

els.nextBtn.addEventListener('click', () => {
    cancelAnimationFrame(rafId);
    els.beatZonesContainer.innerHTML = '';
    els.timelineProgress.style.width = '0%';

    if (songQueue.length > 0) {
        playNextInQueue();
    } else {
        player.stopVideo();
        els.loader.style.display = 'flex';
        els.standbyImg.style.display = 'block';
        els.scoreHint.innerText = "Queue is empty! Search for a song.";
    }
});

// --- Modal Logic ---
els.infoBtn.addEventListener('click', () => els.modal.style.display = 'flex');
els.closeModalBtn.addEventListener('click', () => els.modal.style.display = 'none');
window.addEventListener('click', (e) => {
    if (e.target === els.modal) els.modal.style.display = 'none';
});

// --- Leaderboard Logic ---
function updateLeaderboardUI() {
    els.rankList.innerHTML = '';
    if (leaderboardData.length === 0) {
        els.rankList.innerHTML = '<div style="font-size: 12px; color: #555;">No scores yet</div>';
        return;
    }

    leaderboardData.sort((a, b) => b.score - a.score);

    leaderboardData.slice(0, 5).forEach((entry, i) => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; font-size: 11px; padding: 5px; background: #1a1a1a; border-radius: 3px; color: #eee;";
        let rankColor = i === 0 ? '#f5c842' : (i === 1 ? '#c0c0c0' : (i === 2 ? '#cd7f32' : '#888'));
        div.innerHTML = `
            <span><strong style="color: ${rankColor}; margin-right: 6px;">#${i+1}</strong> ${entry.name}</span>
            <span style="font-family: 'Space Mono', monospace; color: #00e5b0;">${entry.score.toLocaleString("en-US", { minimumIntegerDigits: 6, useGrouping: false })}</span>
        `;
        els.rankList.appendChild(div);
    });
}

els.resetRankBtn.addEventListener('click', () => {
    leaderboardData = [];
    updateLeaderboardUI();
    saveState();
});

loadState();
initUI();
loadSongMenu();