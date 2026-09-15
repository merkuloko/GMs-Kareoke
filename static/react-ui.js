const { useEffect, useMemo, useRef, useState } = React;

const DEFAULT_SONG = {
  id: 'BhSZGUXeY6Q',
  title: 'Karaoke Song',
  artist: '',
  rhythm_map: [],
};

function fetchJson(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', ...options }).then(async (response) => {
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      throw new Error((data && data.error) || 'Request failed');
    }
    return data;
  });
}

function formatScore(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(6, '0');
}

function normalizeSong(song) {
  if (!song) return { ...DEFAULT_SONG };
  return {
    id: song.youtube_id || song.id || DEFAULT_SONG.id,
    title: song.title || 'Untitled song',
    artist: song.artist || '',
    rhythm_map: Array.isArray(song.rhythm_map) ? song.rhythm_map : [],
    requestor: song.requestor || song.singer_name || '',
  };
}

function App() {
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [queue, setQueue] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSong, setCurrentSong] = useState(DEFAULT_SONG);
  const [scoringEnabled, setScoringEnabled] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [mobileQueueEnabled, setMobileQueueEnabled] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [isSinging, setIsSinging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [songPickerText, setSongPickerText] = useState('');
  const [songFinished, setSongFinished] = useState(null);
  const [singerName, setSingerName] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [completedResult, setCompletedResult] = useState(null);

  const playerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const rafRef = useRef(null);
  const currentRhythmRef = useRef([]);
  const scoreRef = useRef(score);
  const currentSongRef = useRef(currentSong);
  const queueRef = useRef(queue);
  const scoringEnabledRef = useRef(scoringEnabled);
  const finishedSongRef = useRef(null);
  const advanceTimerRef = useRef(null);
  const singerInputRef = useRef(null);

  useEffect(() => {
    scoreRef.current = score;
    currentSongRef.current = currentSong;
    queueRef.current = queue;
    scoringEnabledRef.current = scoringEnabled;
  }, [score, currentSong, queue, scoringEnabled]);

  useEffect(() => () => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
  }, []);

  useEffect(() => {
    if (!songFinished || completedResult) return undefined;
    const focusTimer = window.setTimeout(() => singerInputRef.current?.focus(), 0);
    const handleEscape = (event) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [songFinished, completedResult]);

  const displayLeaderboard = useMemo(
    () => [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 5),
    [leaderboard]
  );

  function updatePlayerVideo(videoId) {
    if (!playerRef.current || typeof playerRef.current.loadVideoById !== 'function') return;
    playerRef.current.loadVideoById({ videoId, startSeconds: 0 });
  }

  function openSongFinished(song = currentSongRef.current) {
    const completedSong = normalizeSong(song);
    if (finishedSongRef.current === completedSong.id || songFinished) return;
    finishedSongRef.current = completedSong.id;
    setIsPlaying(false);
    setIsSinging(false);
    setSingerName('');
    setSubmissionError('');
    setCompletedResult(null);
    setSongFinished({
      song: completedSong,
      score: scoringEnabledRef.current ? scoreRef.current : 0,
    });
  }

  function advanceAfterCompletion() {
    const next = queueRef.current.length > 0 ? normalizeSong(queueRef.current[0]) : null;
    if (next) {
      setCurrentSong(next);
      setQueue((previous) => previous.slice(1));
      setSongPickerText(next.title);
      scoreRef.current = 0;
      setScore(0);
      finishedSongRef.current = null;
      updatePlayerVideo(next.id);
    } else {
      setStatusMessage('Song saved. Queue is ready for the next singer.');
      setScore(0);
      finishedSongRef.current = null;
    }
    setSongFinished(null);
    setCompletedResult(null);
  }

  async function submitSingerName(event) {
    if (event) event.preventDefault();
    if (!songFinished || isSubmittingScore) return;

    const name = singerName.trim();
    if (!name) {
      setSubmissionError('Please enter your name to continue.');
      return;
    }
    if (name.length > 15) {
      setSubmissionError('Please keep your name to 15 characters or fewer.');
      return;
    }

    setIsSubmittingScore(true);
    setSubmissionError('');
    const payload = {
      name,
      score: songFinished.score,
      song_title: songFinished.song.title,
    };

    try {
      const entry = await fetchJson('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const savedEntry = entry && typeof entry === 'object' ? entry : payload;
      setLeaderboard((previous) => {
        const withoutDuplicate = previous.filter((item) => !(
          item.name === savedEntry.name &&
          Number(item.score) === Number(savedEntry.score) &&
          item.song_title === savedEntry.song_title
        ));
        return [...withoutDuplicate, savedEntry]
          .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
          .slice(0, 5);
      });
      setCompletedResult(savedEntry);
      setStatusMessage(`Score saved for ${name}.`);
      advanceTimerRef.current = window.setTimeout(advanceAfterCompletion, 1400);
    } catch (error) {
      setSubmissionError(error.message || 'Unable to save your score. Please try again.');
    } finally {
      setIsSubmittingScore(false);
    }
  }

  function ensurePlayer() {
    if (playerRef.current || !window.YT || !window.YT.Player) return;

    const player = new window.YT.Player('yt-player', {
      videoId: currentSong.id,
      playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          playerRef.current = player;
          setIsPlaying(false);
          setCurrentSong((song) => ({ ...song }));
        },
        onStateChange: (event) => {
          const playing = event.data === window.YT.PlayerState.PLAYING;
          setIsPlaying(playing);

          if (event.data === window.YT.PlayerState.ENDED) {
            openSongFinished();
          }
        },
      },
    });

    playerRef.current = player;
  }

  useEffect(() => {
    window.onYouTubeIframeAPIReady = function() {
      ensurePlayer();
    };
    ensurePlayer();
  }, [currentSong.id]);

  useEffect(() => {
    async function loadLiveQueue() {
      try {
        const items = await fetchJson('/api/live-queue');
        if (!Array.isArray(items)) return;
        setQueue(items.map((item) => normalizeSong({
          ...item,
          db_id: item.db_id || item.id,
          requestor: item.singer_name,
        })));
      } catch (error) {
        setStatusMessage('Live queue is temporarily unavailable.');
      }
    }

    async function loadInitialData() {
      const [configResult, songsResult, leaderboardResult] = await Promise.allSettled([
        fetchJson('/api/config'),
        fetchJson('/api/songs'),
        fetchJson('/api/leaderboard'),
      ]);

      if (songsResult.status === 'fulfilled') {
        const normalizedSongs = Array.isArray(songsResult.value)
          ? songsResult.value.map(normalizeSong)
          : [];
        if (normalizedSongs.length) {
          setCurrentSong(normalizedSongs[0]);
          setSongPickerText(normalizedSongs[0].title);
        }
      } else {
        setStatusMessage('Song catalog unavailable. Check the song database configuration.');
      }

      if (leaderboardResult.status === 'fulfilled') {
        setLeaderboard(Array.isArray(leaderboardResult.value) ? leaderboardResult.value : []);
      }

      if (configResult.status === 'fulfilled') {
        const config = configResult.value;
        setMobileQueueEnabled(Boolean(config && config.mobile_queue_enabled));
        if (config && config.mobile_queue_enabled && config.mobile_queue_url) {
          try {
            const qrResult = await fetchJson('/api/queue-qr');
            setQrUrl(qrResult && qrResult.url ? qrResult.url : '');
          } catch (error) {
            setStatusMessage('Mobile queue QR is unavailable.');
          }
        }
      }

      await loadLiveQueue();
    }

    loadInitialData();
    const queueTimer = window.setInterval(loadLiveQueue, 5000);
    return () => window.clearInterval(queueTimer);
  }, []);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!micActive || !isPlaying || !analyser) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const data = dataArrayRef.current || new Uint8Array(analyser.fftSize);
    dataArrayRef.current = data;

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(data);
      const rms = Array.from(data).reduce((sum, value) => {
        const normalized = (value / 128) - 1;
        return sum + normalized * normalized;
      }, 0) / data.length;
      const singing = Math.sqrt(rms) > 0.018;
      setIsSinging(singing);

      if (scoringEnabled && singing) {
        setScore((prev) => prev + 1);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [micActive, isPlaying, scoringEnabled]);

  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) {
      setStatusMessage('Enter a song or artist to search.');
      return;
    }

    setStatusMessage('Searching...');
    try {
      const results = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
      const items = Array.isArray(results) ? results : [];
      setSearchResults(items);
      setStatusMessage(items.length ? '' : 'No songs found.');
    } catch (error) {
      setStatusMessage(error.message || 'Search failed.');
    }
  }

  async function addSongToQueue(song) {
    const normalized = normalizeSong(song);
    try {
      await fetchJson('/api/live-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtube_id: normalized.id,
          title: normalized.title,
          singer_name: 'Guest',
        }),
      });
      setQueue((prev) => [...prev, normalized]);
      setStatusMessage('Added to queue.');
      if (!currentSong || currentSong.id === DEFAULT_SONG.id) {
        setCurrentSong(normalized);
        updatePlayerVideo(normalized.id);
      }
    } catch (error) {
      setStatusMessage(error.message || 'Unable to add song to queue.');
    }
  }

  async function clearQueue() {
    try {
      await fetchJson('/api/live-queue', { method: 'DELETE' });
      setQueue([]);
      setStatusMessage('Queue cleared.');
    } catch (error) {
      setStatusMessage(error.message || 'Unable to clear queue.');
    }
  }

  async function clearLeaderboard() {
    try {
      await fetchJson('/api/leaderboard', { method: 'DELETE' });
      setLeaderboard([]);
      setStatusMessage('Leaderboard cleared.');
    } catch (error) {
      setStatusMessage(error.message || 'Unable to clear leaderboard.');
    }
  }

  async function toggleMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatusMessage('Microphone access is not available in this browser.');
      return;
    }

    if (micActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        await audioCtxRef.current.close();
      }
      streamRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
      setMicActive(false);
      setIsSinging(false);
      setStatusMessage('');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      streamRef.current = stream;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.fftSize);
      audioCtxRef.current = audioCtx;
      setMicActive(true);
      setStatusMessage('');
    } catch (error) {
      setStatusMessage('Microphone access was denied.');
    }
  }

  function nextSong() {
    openSongFinished();
  }

  function setSongByText(event) {
    const selected = event.target.value;
    if (!selected) return;
    const nextSong = normalizeSong({ youtube_id: selected, title: selected, artist: 'Queue item' });
    setCurrentSong(nextSong);
    setSongPickerText(nextSong.title);
    updatePlayerVideo(nextSong.id);
  }

  return React.createElement(
    'div',
    { className: 'app-shell' },
    React.createElement(
      'div',
      { className: 'app-frame' },
      React.createElement(
        'header',
        { className: 'topbar' },
        React.createElement(
          'div',
          { className: 'brand' },
          React.createElement('span', { className: 'brand-mark' }),
          React.createElement('div', { className: 'brand-text' }, 'GM’s Kareoke')
        ),
        React.createElement(
          'div',
          { className: 'topbar-actions' },
          React.createElement(
            'div',
            { className: 'session-meta' },
            React.createElement('span', { className: 'live-badge' }, React.createElement('span', { className: 'live-dot' }), 'LIVE'),
            React.createElement('span', { className: 'session-label' }, 'Friday night session')
          ),
          React.createElement('button', { className: 'info-button', onClick: () => setModalOpen(true) }, 'i'),
          React.createElement(
            'div',
            { className: `action-pill ${isSinging ? 'active' : ''}` },
            React.createElement('span', { className: 'action-dot' }),
            React.createElement('span', { className: 'pill-label' }, isSinging ? 'Singing' : 'Silent')
          ),
          React.createElement(
            'div',
            { className: 'mic-pill' },
            React.createElement('span', { className: `mic-dot ${micActive ? 'active' : ''}` }),
            React.createElement('span', { className: 'pill-label' }, micActive ? 'Mic on' : 'No mic')
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'content-grid' },
        React.createElement(
          'aside',
          { className: 'side-column' },
          React.createElement(
            'div',
            { className: 'card side-panel' },
            React.createElement(
              'div',
              { className: 'panel-header' },
              React.createElement('div', { className: 'panel-title' }, 'Leaderboard'),
              React.createElement('button', { className: 'small-button', onClick: clearLeaderboard }, 'Clear')
            ),
            React.createElement(
              'div',
              { className: 'list-stack' },
              displayLeaderboard.length === 0
                ? React.createElement('div', { className: 'empty-message' }, 'No scores yet')
                : displayLeaderboard.map((entry, index) => React.createElement(
                    'div',
                    { key: `${entry.name}-${index}`, className: 'list-item' },
                    React.createElement(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                      React.createElement('span', { className: `rank ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}` }, `#${index + 1}`),
                      React.createElement('span', null, entry.name || 'Guest')
                    ),
                    React.createElement('strong', { style: { color: '#7dd3fc' } }, formatScore(entry.score || 0))
                  ))
            )
          )
        ),
        React.createElement(
          'main',
          { className: 'stage-column' },
          React.createElement(
            'div',
            { className: 'card player-card' },
            React.createElement(
              'div',
              { className: 'now-playing-head' },
              React.createElement(
                'div',
                { className: 'now-playing-copy' },
                React.createElement('div', { className: 'eyebrow' }, 'Now playing'),
                React.createElement('h1', null, currentSong.title || 'Choose a song to begin'),
                React.createElement('div', { className: 'song-byline' }, currentSong.artist || 'Karaoke track', ' · ', currentSong.requestor || 'Guest singer')
              ),
              React.createElement('div', { className: 'playing-state' }, React.createElement('span', { className: `state-dot ${isPlaying ? 'is-playing' : ''}` }), isPlaying ? 'Playing' : 'Ready')
            ),
            React.createElement(
              'div',
              { className: `player-window ${isSinging ? 'singing' : ''}` },
              React.createElement('div', { id: 'yt-player', className: 'player-video' }),
              !isPlaying && React.createElement('img', {
                className: 'player-standby',
                src: '/static/standby.png',
                alt: 'Standby',
              }),
              !isPlaying && React.createElement(
                'div',
                { className: 'player-loader' },
                React.createElement('div', { className: 'loader-text' }, 'Ready'),
                React.createElement(
                  'div',
                  { className: 'loader-dots' },
                  React.createElement('span', { className: 'loader-dot' }),
                  React.createElement('span', { className: 'loader-dot' }),
                  React.createElement('span', { className: 'loader-dot' })
                )
              )
            ),
            React.createElement(
              'div',
              { className: 'timeline' },
              React.createElement('div', { className: 'timeline-progress', style: { width: `${Math.min(100, isPlaying ? 68 : 12)}%` } })
            ),
            React.createElement(
              'div',
              { className: 'score-row' },
              React.createElement(
                'div',
                { className: 'score-block' },
                React.createElement('div', { className: 'score-label' }, 'Score'),
                React.createElement('div', { className: 'score-value' }, formatScore(score)),
                React.createElement('div', { className: 'score-hint' }, scoringEnabled ? (micActive ? (isSinging ? 'Keep singing!' : 'Sing on the beat') : 'Enable mic to start scoring') : 'Scoring is off. Enjoy the music.')
              ),
              React.createElement(
                'div',
                { className: 'singer-status' },
                React.createElement('div', { className: 'score-label' }, 'Current singer'),
                React.createElement('strong', null, currentSong.requestor || 'Guest singer'),
                React.createElement('span', null, isSinging ? 'Voice detected' : micActive ? 'Listening for vocals' : 'Microphone ready')
              )
            ),
            React.createElement(
              'div',
              { className: 'vu-wrap' },
              React.createElement('div', { className: 'vu-label', style: { textAlign: 'center' } }, 'Mic input'),
              React.createElement(
                'div',
                { className: 'vu-meter' },
                Array.from({ length: 18 }, (_, index) => {
                  const active = micActive && index / 18 < (isSinging ? 1 : 0.35);
                  return React.createElement('span', {
                    key: index,
                    className: 'vu-bar',
                    style: {
                      height: `${12 + ((index % 5) * 16) + (micActive ? 8 : 0)}px`,
                      background: active ? 'linear-gradient(180deg, #7dd3fc, #38bdf8)' : 'rgba(148,163,184,0.18)',
                    },
                  });
                })
              )
            ),
            React.createElement(
              'div',
              { className: 'controls' },
              React.createElement('button', { className: 'primary-button', onClick: toggleMicrophone }, micActive ? 'Stop mic' : 'Enable mic'),
              React.createElement('button', { className: `toggle-button ${scoringEnabled ? '' : 'off'}`, onClick: () => setScoringEnabled((value) => !value) }, scoringEnabled ? 'Scoring on' : 'Scoring off'),
              React.createElement('button', { className: 'secondary-button', onClick: nextSong }, 'Next song'),
              React.createElement('button', { className: 'secondary-button', onClick: () => setScore(0) }, 'Reset')
            ),
            React.createElement('div', { className: `status-box ${statusMessage ? 'has-message' : ''}` }, statusMessage || 'Ready for the next singer.'),
            React.createElement(
              'div',
              { className: 'legend' },
              currentSong && currentSong.rhythm_map && currentSong.rhythm_map.length
                ? currentSong.rhythm_map.map((zone, index) => React.createElement(
                    'div',
                    { key: `${zone.label || 'Beat'}-${index}`, className: 'legend-chip' },
                    React.createElement('span', { className: 'chip-label' }, zone.label || 'Beat'),
                    React.createElement('span', { className: 'chip-time' }, `${zone.start}s - ${zone.end}s`)
                  ))
                : React.createElement('div', { className: 'legend-chip' }, React.createElement('span', { className: 'chip-label' }, 'Free play'), React.createElement('span', { className: 'chip-time' }, 'No rhythm map'))
            )
          )
        ),
        React.createElement(
          'aside',
          { className: 'side-column' },
          React.createElement(
            'div',
            { className: 'card qr-card' },
            React.createElement('div', { className: 'panel-title' }, 'Mobile request'),
            qrUrl ? React.createElement('img', { className: 'qr-image', src: qrUrl, alt: 'Mobile queue QR', style: { display: 'block' } }) : React.createElement('div', { className: 'qr-image placeholder' }, 'QR unavailable'),
            React.createElement('div', { className: 'qr-copy' }, mobileQueueEnabled ? 'Scan to open the mobile queue' : 'Set MOBILE_QUEUE_URL to enable mobile queue')
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'search-and-queue' },
        React.createElement(
          'div',
          { className: 'card panel-block' },
          React.createElement(
            'div',
            { className: 'panel-header' },
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'panel-title' }, 'Find a track'),
              React.createElement('div', { className: 'panel-subtitle' }, 'Search YouTube and add it to the set')
            ),
            React.createElement('span', { className: 'result-count' }, searchResults.length ? `${searchResults.length} results` : 'Library search')
          ),
          React.createElement(
            'div',
            { className: 'search-row' },
            React.createElement('input', {
              className: 'search-input',
              value: searchQuery,
              onChange: (event) => setSearchQuery(event.target.value),
              placeholder: 'Search songs, artists…',
              onKeyDown: (event) => {
                if (event.key === 'Enter') handleSearch();
              },
            }),
            React.createElement('button', { className: 'primary-button search-button', onClick: handleSearch }, '⌕')
          ),
          React.createElement(
            'div',
            { className: 'search-results' },
            searchResults.length === 0
              ? React.createElement('div', { className: 'empty-message' }, 'No results yet')
              : searchResults.map((video) => React.createElement(
                  'div',
                  {
                    key: video.id,
                    className: 'result-card',
                    onClick: () => addSongToQueue(video),
                  },
                  React.createElement('img', { src: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/default.jpg`, alt: video.title || 'Video thumbnail' }),
                  React.createElement(
                    'div',
                    { className: 'result-copy' },
                    React.createElement('strong', null, video.title || 'Untitled song'),
                    React.createElement('span', null, video.artist || video.channel || 'YouTube karaoke')
                  ),
                  React.createElement(
                    'button',
                    {
                      className: 'add-button',
                      onClick: (event) => {
                        event.stopPropagation();
                        addSongToQueue(video);
                      },
                    },
                    'Add'
                  )
                ))
          )
        ),
        React.createElement(
          'div',
          { className: 'card panel-block' },
          React.createElement(
            'div',
            { className: 'panel-header' },
            React.createElement(
              'div',
              null,
              React.createElement('div', { className: 'panel-title' }, 'Queue'),
              React.createElement('div', { className: 'panel-subtitle' }, `${queue.length} ${queue.length === 1 ? 'song' : 'songs'} waiting`)
            ),
            React.createElement('button', { className: 'small-button', onClick: clearQueue }, 'Clear queue')
          ),
          React.createElement(
            'div',
            { className: 'list-stack' },
            React.createElement(
              'div',
              { className: 'queue-item queue-playing' },
              React.createElement('span', { className: 'queue-number' }, '00'),
              React.createElement(
                'div',
                { className: 'queue-copy' },
                React.createElement('span', { className: 'queue-state' }, 'Now playing'),
                React.createElement('strong', null, currentSong.requestor || 'Guest singer'),
                React.createElement('span', null, currentSong.title || 'No song selected')
              ),
              React.createElement('span', { className: 'queue-more' }, isPlaying ? '●' : 'Ⅱ')
            ),
            queue.length === 0
              ? React.createElement('div', { className: 'empty-message' }, 'No upcoming songs')
              : queue.map((song, index) => React.createElement(
                  'div',
                  { key: `${song.id}-${index}`, className: `queue-item ${index === 0 ? 'queue-next' : ''}` },
                  React.createElement('span', { className: 'queue-number' }, String(index + 1).padStart(2, '0')),
                  React.createElement(
                    'div',
                    { className: 'queue-copy' },
                    React.createElement('span', { className: 'queue-state' }, index === 0 ? 'Next' : 'Queued'),
                    React.createElement('strong', null, song.requestor || 'Guest singer'),
                    React.createElement('span', null, song.title)
                  ),
                  React.createElement('span', { className: 'queue-more' }, '···')
                ))
          )
        )
      ),
      songFinished && React.createElement(
        'div',
        { className: 'modal song-finished-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'song-finished-title' },
        React.createElement(
          'div',
          { className: 'modal-panel song-finished-panel' },
          completedResult
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { className: 'finished-kicker' }, 'Score saved'),
                React.createElement('h2', { id: 'song-finished-title' }, 'Nice singing, ', completedResult.name),
                React.createElement('p', { className: 'finished-song' }, songFinished.song.title),
                React.createElement('div', { className: 'finished-score' }, formatScore(completedResult.score)),
                React.createElement('div', { className: 'finished-caption' }, 'Moving to the next singer…')
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { className: 'finished-kicker' }, 'Song finished'),
                React.createElement('h2', { id: 'song-finished-title' }, "What's your name?"),
                React.createElement('p', { className: 'finished-description' }, 'Add your name to the leaderboard.'),
                React.createElement(
                  'form',
                  { onSubmit: submitSingerName, noValidate: true },
                  React.createElement('label', { htmlFor: 'singer-name' }, 'Singer name'),
                  React.createElement('input', {
                    ref: singerInputRef,
                    id: 'singer-name',
                    name: 'singerName',
                    type: 'text',
                    value: singerName,
                    maxLength: 15,
                    autoComplete: 'name',
                    placeholder: 'Enter your name…',
                    onChange: (event) => {
                      setSingerName(event.target.value);
                      if (submissionError) setSubmissionError('');
                    },
                    'aria-describedby': submissionError ? 'singer-name-error' : undefined,
                    'aria-invalid': Boolean(submissionError),
                    disabled: isSubmittingScore,
                  }),
                  submissionError && React.createElement('div', { id: 'singer-name-error', className: 'form-error', role: 'alert' }, submissionError),
                  React.createElement(
                    'button',
                    { className: 'primary-button continue-button', type: 'submit', disabled: isSubmittingScore },
                    isSubmittingScore ? 'Saving score…' : 'Continue'
                  )
                )
              )
        )
      ),
      modalOpen && React.createElement(
        'div',
        { className: 'modal', onClick: () => setModalOpen(false) },
        React.createElement(
          'div',
          { className: 'modal-panel', onClick: (event) => event.stopPropagation() },
          React.createElement('button', { className: 'modal-close', onClick: () => setModalOpen(false) }, '×'),
          React.createElement('h3', null, 'How to use'),
          React.createElement('ol', null,
            React.createElement('li', null, 'Enable the mic and allow browser permissions.'),
            React.createElement('li', null, 'Search for a karaoke track and add it to the queue.'),
            React.createElement('li', null, 'Use the next-song control to move through the set.'),
            React.createElement('li', null, 'Scoring can be toggled on or off at any time.')
          )
        )
      )
    )
  );
}

window.onYouTubeIframeAPIReady = function() {
  window.__ytReady = true;
};

document.addEventListener('DOMContentLoaded', function() {
  const root = document.getElementById('root');
  if (!root) return;
  ReactDOM.createRoot(root).render(React.createElement(App));
});
