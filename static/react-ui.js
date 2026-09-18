const { useEffect, useMemo, useRef, useState } = React;

const DEFAULT_SONG = {
  id: '',
  title: '',
  artist: '',
  rhythm_map: [],
};
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomStorageKey = 'karaoke_room_id';
function generateRoomId() {
  return Array.from(
    { length: 5 },
    () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
  ).join('');
}

function getStoredRoomId() {
  const existing = window.localStorage.getItem(roomStorageKey);
  if (existing && /^[A-Z0-9]{5}$/.test(existing)) return existing;
  const generated = generateRoomId();
  window.localStorage.setItem(roomStorageKey, generated);
  return generated;
}

function roomUrl(path, roomId) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}room_id=${encodeURIComponent(roomId)}`;
}

function fetchJson(url, options = {}) {
  return fetch(url, { ...options, credentials: options.credentials || 'same-origin' }).then(async (response) => {
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
    db_id: song.db_id || song.id || '',
    title: song.title || 'Untitled song',
    artist: song.artist || '',
    rhythm_map: Array.isArray(song.rhythm_map) ? song.rhythm_map : [],
    requestor: song.requestor || song.singer_name || '',
  };
}

function App() {
  const [roomId, setRoomId] = useState(getStoredRoomId);
  const [deviceType, setDeviceType] = useState(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [existingRoomInput, setExistingRoomInput] = useState('');
  const [score, setScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [queue, setQueue] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [songCatalog, setSongCatalog] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
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
  const [draggedQueueId, setDraggedQueueId] = useState(null);

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
  const queueSubmissionRef = useRef(false);

  useEffect(() => {
    scoreRef.current = score;
    currentSongRef.current = currentSong;
    queueRef.current = queue;
    scoringEnabledRef.current = scoringEnabled;
  }, [score, currentSong, queue, scoringEnabled]);

  useEffect(() => {
    if (deviceType === 'tv') {
      setScoringEnabled(false);
      setMicActive(false);
    }
  }, [deviceType]);

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
    if (!scoringEnabledRef.current) {
      advanceAfterCompletion();
      return;
    }
    setSingerName('');
    setSubmissionError('');
    setCompletedResult(null);
    setSongFinished({
      song: completedSong,
      score: scoringEnabledRef.current ? scoreRef.current : 0,
    });
  }

  async function advanceAfterCompletion() {
    const next = queueRef.current.length > 0 ? normalizeSong(queueRef.current[0]) : null;
    if (next) {
      setCurrentSong(next);
      setQueue((previous) => previous.slice(1));
      setSongPickerText(next.title);
      scoreRef.current = 0;
      setScore(0);
      finishedSongRef.current = null;
      setIsPlaying(true);
      setSongFinished(null);
      setCompletedResult(null);
      setModalOpen(false);
      if (playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
        playerRef.current.loadVideoById({ videoId: next.id, startSeconds: 0 });
      }
      if (next.db_id) {
        try {
          await fetchJson(roomUrl(`/api/live-queue/${encodeURIComponent(next.db_id)}`, roomId), {
            method: 'DELETE',
          });
        } catch (error) {
          setStatusMessage('Next song is playing, but its queue entry could not be cleared.');
        }
      }
    } else {
      setStatusMessage('Song saved. Queue is ready for the next singer.');
      setScore(0);
      finishedSongRef.current = null;
      setIsPlaying(false);
      setModalOpen(false);
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
      room_id: roomId,
    };

    try {
      const entry = await fetchJson(roomUrl('/api/leaderboard', roomId), {
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
    if (!currentSong.id || playerRef.current || !window.YT || !window.YT.Player) return;

    const player = new window.YT.Player('yt-player', {
      videoId: currentSong.id,
      playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          playerRef.current = player;
          setIsPlaying(false);
          if (currentSongRef.current.id) {
            player.loadVideoById({ videoId: currentSongRef.current.id, startSeconds: 0 });
            setIsPlaying(true);
          }
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
    if (!sessionActive) return undefined;
    ensurePlayer();
    return undefined;
  }, [currentSong.id, sessionActive]);

  useEffect(() => {
    if (!sessionActive) return undefined;

    async function loadLiveQueue() {
      try {
        const items = await fetchJson(roomUrl('/api/live-queue', roomId));
        if (!Array.isArray(items)) return;
        const activeSongId = currentSongRef.current.id;
        const waitingItems = items.filter((item) => {
          const itemVideoId = item.youtube_id || item.id;
          return String(itemVideoId) !== String(activeSongId);
        });
        setQueue(waitingItems.map((item) => normalizeSong({
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
        fetchJson(roomUrl('/api/config', roomId)),
        fetchJson('/api/songs'),
        fetchJson(roomUrl('/api/leaderboard', roomId)),
      ]);

      if (songsResult.status === 'fulfilled') {
        const normalizedSongs = Array.isArray(songsResult.value)
          ? songsResult.value.map(normalizeSong)
          : [];
        setSongCatalog(normalizedSongs);
        if (!normalizedSongs.length) setStatusMessage('Song catalog is empty.');
      } else {
        setStatusMessage('Song catalog unavailable. Check the song database configuration.');
      }

      if (leaderboardResult.status === 'fulfilled') {
        setLeaderboard(Array.isArray(leaderboardResult.value) ? leaderboardResult.value : []);
      }

      if (configResult.status === 'fulfilled') {
        const config = configResult.value;
        if (deviceType !== 'tv' && typeof config.scoring_enabled === 'boolean') {
          setScoringEnabled(config.scoring_enabled);
        }
        setMobileQueueEnabled(Boolean(config && config.mobile_queue_enabled));
        if (config && config.mobile_queue_enabled && config.mobile_queue_url) {
          try {
            const qrResult = await fetchJson(roomUrl('/api/queue-qr', roomId));
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
  }, [roomId, sessionActive, currentSong.id, deviceType]);

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

    const queryLower = query.toLowerCase();
    const fallbackCatalogMatches = songCatalog.filter((song) => {
      const title = (song.title || '').toLowerCase();
      const artist = (song.artist || '').toLowerCase();
      return title.includes(queryLower) || artist.includes(queryLower);
    });

    setIsSearching(true);
    setStatusMessage('');
    try {
      const results = await fetchJson(roomUrl(`/api/search?q=${encodeURIComponent(query)}`, roomId));
      let items = Array.isArray(results) ? results : [];
      if (!items.length && fallbackCatalogMatches.length) {
        items = fallbackCatalogMatches;
      }
      setSearchResults(items);
      setStatusMessage(items.length ? '' : 'No songs found.');
    } catch (error) {
      if (fallbackCatalogMatches.length) {
        setSearchResults(fallbackCatalogMatches);
        setStatusMessage('');
        return;
      }
      setSearchResults([]);
      setStatusMessage(
        error.message ||
        'Live search is unavailable. Add YOUTUBE_API to .env and restart Flask.'
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function addSongToQueue(song) {
    if (queueSubmissionRef.current) return;
    const videoId = String(song?.youtube_id || song?.id || '').trim();
    const title = String(song?.title || '').trim();
    if (!videoId || !title) {
      setStatusMessage('This search result is missing a song ID or title.');
      return;
    }
    const normalized = normalizeSong({
      ...song,
      youtube_id: videoId,
      title,
    });
    queueSubmissionRef.current = true;
    try {
      await fetchJson(roomUrl('/api/live-queue', roomId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtube_id: videoId,
          title,
          singer_name: 'Guest',
          room_id: roomId,
        }),
      });
      setStatusMessage('Added to queue.');
      const playerIsIdle = !currentSongRef.current.id && !isPlaying;
      if (playerIsIdle) {
        setCurrentSong(normalized);
        setSongPickerText(normalized.title);
        setIsPlaying(true);
        setQueue((previous) => previous.filter((item) => item.id !== normalized.id));
        if (playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
          playerRef.current.loadVideoById({ videoId: normalized.id, startSeconds: 0 });
        }
        if (normalized.db_id) {
          await fetchJson(roomUrl(`/api/live-queue/${encodeURIComponent(normalized.db_id)}`, roomId), {
            method: 'DELETE',
          });
        }
      }
    } catch (error) {
      setStatusMessage(error.message || 'Unable to add song to queue.');
    } finally {
      queueSubmissionRef.current = false;
    }
  }

  async function removeQueueItem(song) {
    const itemId = song.db_id || song.id;
    if (!itemId) {
      setStatusMessage('This queue item cannot be removed.');
      return;
    }

    try {
      await fetchJson(roomUrl(`/api/live-queue/${encodeURIComponent(itemId)}`, roomId), { method: 'DELETE' });
      setQueue((previous) => previous.filter((item) => String(item.db_id || item.id) !== String(itemId)));
      setStatusMessage('Song removed from queue.');
    } catch (error) {
      setStatusMessage(error.message || 'Unable to remove song from queue.');
    }
  }

  async function reorderQueue(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = queue.findIndex((song) => String(song.db_id || song.id) === String(sourceId));
    const targetIndex = queue.findIndex((song) => String(song.db_id || song.id) === String(targetId));
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextQueue = [...queue];
    const [movedSong] = nextQueue.splice(sourceIndex, 1);
    nextQueue.splice(targetIndex, 0, movedSong);
    setQueue(nextQueue);
    setDraggedQueueId(null);

    try {
      await fetchJson(roomUrl('/api/live-queue/reorder', roomId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_ids: nextQueue.map((song) => song.db_id || song.id),
          room_id: roomId,
        }),
      });
      setStatusMessage('Queue order saved.');
    } catch (error) {
      setStatusMessage(error.message || 'Unable to save queue order.');
      setQueue(queue);
    }
  }

  async function clearQueue() {
    try {
      await fetchJson(roomUrl('/api/live-queue', roomId), { method: 'DELETE' });
      setQueue([]);
      setStatusMessage('Queue cleared.');
    } catch (error) {
      setStatusMessage(error.message || 'Unable to clear queue.');
    }
  }

  async function clearLeaderboard() {
    try {
      await fetchJson(roomUrl('/api/leaderboard', roomId), { method: 'DELETE' });
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

  function togglePlayback() {
    if (!playerRef.current) return;
    if (isPlaying && typeof playerRef.current.pauseVideo === 'function') {
      playerRef.current.pauseVideo();
    } else if (typeof playerRef.current.playVideo === 'function') {
      playerRef.current.playVideo();
    }
  }

  function setSongByText(event) {
    const selected = event.target.value;
    if (!selected) return;
    const nextSong = normalizeSong({ youtube_id: selected, title: selected, artist: 'Queue item' });
    setCurrentSong(nextSong);
    setSongPickerText(nextSong.title);
    updatePlayerVideo(nextSong.id);
  }

  function startNewSession() {
    const nextRoomId = generateRoomId();
    setRoomId(nextRoomId);
    window.localStorage.setItem(roomStorageKey, nextRoomId);
  }

  function resumeSession() {
    const nextRoomId = existingRoomInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(nextRoomId)) return;
    setRoomId(nextRoomId);
    window.localStorage.setItem(roomStorageKey, nextRoomId);
    setSessionActive(true);
  }

  if (!sessionActive) {
    return React.createElement(
      'div',
      {
        className: 'app-shell',
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          width: '100vw',
          boxSizing: 'border-box',
        },
      },
      React.createElement(
        'div',
        {
          className: 'app-frame onboarding-frame',
          style: { width: '100%', display: 'flex', justifyContent: 'center' },
        },
        React.createElement(
          'main',
          {
            className: 'onboarding-card card',
            style: {
            width: 'min(100%, 520px)',
            padding: '42px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            },
          },
          React.createElement('div', { className: 'brand-mark onboarding-mark' }),
          !deviceType
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('div', { className: 'eyebrow' }, 'Device setup'),
                React.createElement('h1', null, "How are you using GM's Karaoke today?"),
                React.createElement('p', { className: 'panel-subtitle' }, 'Choose the experience that fits your screen.'),
                React.createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' } },
                  React.createElement('button', {
                    className: 'secondary-button',
                    style: { minHeight: '72px', textAlign: 'left', padding: '16px 20px' },
                    onClick: () => setDeviceType('laptop'),
                  }, React.createElement('strong', null, 'Laptop / Computer (Host)'), React.createElement('small', { style: { display: 'block', marginTop: '5px', color: 'var(--muted)' } }, 'Full experience with live scoring.')),
                  React.createElement('button', {
                    className: 'secondary-button',
                    style: { minHeight: '72px', textAlign: 'left', padding: '16px 20px' },
                    onClick: () => setDeviceType('tv'),
                  }, React.createElement('strong', null, 'Smart TV (Display Only)'), React.createElement('small', { style: { display: 'block', marginTop: '5px', color: 'var(--muted)' } }, 'Scoring disabled. Best for big screens.')),
                  React.createElement('button', {
                    className: 'secondary-button',
                    style: { minHeight: '72px', textAlign: 'left', padding: '16px 20px' },
                    onClick: () => { window.location.href = '/mobile'; },
                  }, React.createElement('strong', null, 'Smartphone (Guest)'), React.createElement('small', { style: { display: 'block', marginTop: '5px', color: 'var(--muted)' } }, 'Join a room to request songs.'))
                )
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement('button', { className: 'secondary-button', style: { alignSelf: 'flex-start' }, onClick: () => setDeviceType(null) }, '← Back'),
                React.createElement('div', { className: 'eyebrow' }, 'Host console'),
                React.createElement('h1', null, 'Start a karaoke session'),
                React.createElement('p', { className: 'panel-subtitle' }, 'Create a room or resume an existing room code to begin hosting.'),
          React.createElement(
            'div',
            {
              className: 'onboarding-room',
              style: { padding: '18px', border: '1px solid var(--border)', borderRadius: '16px' },
            },
            React.createElement('span', { className: 'eyebrow' }, 'Your room code '),
            React.createElement('strong', null, roomId)
          ),
          React.createElement('button', { className: 'secondary-button', onClick: startNewSession }, 'Generate new code'),
          React.createElement('button', {
            className: 'primary-button onboarding-start',
            style: { width: '100%', minHeight: '48px' },
            onClick: () => setSessionActive(true),
          }, 'Start hosting'),
          React.createElement('div', { className: 'onboarding-divider' }, 'or resume a session'),
          React.createElement('input', {
            className: 'search-input',
            style: { width: '100%', boxSizing: 'border-box' },
            value: existingRoomInput,
            maxLength: 5,
            onChange: (event) => setExistingRoomInput(event.target.value.toUpperCase()),
            placeholder: 'Enter 5-character room code',
            'aria-label': 'Existing room code',
          }),
          React.createElement('button', {
            className: 'secondary-button',
            onClick: resumeSession,
            disabled: !/^[A-Z0-9]{5}$/.test(existingRoomInput.trim().toUpperCase()),
          }, 'Resume session')
              )
        )
      )
    );
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
              React.createElement('span', { className: 'room-indicator' }, `Room: ${roomId}`)
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
              React.createElement('div', {
                id: 'yt-player',
                className: 'player-video',
                style: currentSong.id ? undefined : { display: 'none' },
              }),
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
              deviceType !== 'tv' && React.createElement('button', { className: 'primary-button', onClick: toggleMicrophone }, micActive ? 'Stop mic' : 'Enable mic'),
              deviceType !== 'tv' && React.createElement('button', { className: `toggle-button ${scoringEnabled ? '' : 'off'}`, onClick: () => setScoringEnabled((value) => !value) }, scoringEnabled ? 'Scoring on' : 'Scoring off'),
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
            React.createElement('div', { className: 'qr-copy' }, mobileQueueEnabled ? 'Scan to open the mobile queue' : 'Set MOBILE_QUEUE_URL to enable mobile queue'),
            React.createElement(
              'div',
              {
                className: 'room-code-card',
                style: {
                  gridColumn: '1 / -1',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.28)',
                  border: '1px solid rgba(125, 211, 252, 0.24)',
                  textAlign: 'center',
                },
              },
              React.createElement('span', { className: 'eyebrow' }, 'Room code '),
              React.createElement('strong', null, roomId)
            )
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
            React.createElement('button', { className: 'primary-button search-button', onClick: handleSearch, disabled: isSearching }, isSearching ? '…' : '⌕')
          ),
          React.createElement('div', { className: 'search-status', role: 'status', 'aria-live': 'polite' }, isSearching ? 'Searching…' : ''),
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
              :               queue.map((song, index) => {
                const queueId = String(song.db_id || song.id);
                return React.createElement(
                    'div',
                    {
                      key: queueId,
                      className: `queue-item ${index === 0 ? 'queue-next' : ''} ${draggedQueueId === queueId ? 'queue-dragging' : ''}`,
                      draggable: true,
                      onDragStart: () => setDraggedQueueId(queueId),
                      onDragOver: (event) => event.preventDefault(),
                      onDrop: (event) => {
                        event.preventDefault();
                        reorderQueue(draggedQueueId, queueId);
                      },
                      onDragEnd: () => setDraggedQueueId(null),
                    },
                    React.createElement('span', { className: 'queue-number' }, String(index + 1).padStart(2, '0')),
                  React.createElement(
                    'div',
                    { className: 'queue-copy' },
                    React.createElement('span', { className: 'queue-state' }, index === 0 ? 'Next' : 'Queued'),
                    React.createElement('strong', null, song.requestor || 'Guest singer'),
                    React.createElement('span', null, song.title)
                  ),
                  React.createElement(
                    'button',
                    {
                      className: 'queue-remove',
                      type: 'button',
                      title: 'Remove from queue',
                      'aria-label': `Remove ${song.title || 'song'} from queue`,
                      onClick: () => removeQueueItem(song),
                    },
                    '×'
                  )
                );
            })
          )
        )
      ),
      React.createElement(
        'footer',
        { className: 'playback-bar', 'aria-label': 'Playback controls' },
        React.createElement(
          'div',
          { className: 'playback-track' },
          React.createElement('span', { className: 'playback-kicker' }, 'Now playing'),
          React.createElement('strong', null, currentSong.title || 'Choose a song'),
          React.createElement('span', null, currentSong.requestor || 'Guest singer')
        ),
        React.createElement(
          'div',
          { className: 'playback-actions' },
          React.createElement('button', { className: 'playback-button', type: 'button', onClick: () => setScore(0), 'aria-label': 'Reset score' }, '↺'),
          React.createElement('button', { className: 'playback-button playback-primary', type: 'button', onClick: togglePlayback, 'aria-label': isPlaying ? 'Pause song' : 'Play song' }, isPlaying ? 'Ⅱ' : '▶'),
          React.createElement('button', { className: 'playback-button', type: 'button', onClick: nextSong, 'aria-label': 'Finish song' }, '›')
        ),
        React.createElement(
          'div',
          { className: 'playback-status' },
          React.createElement('span', { className: `state-dot ${isPlaying ? 'is-playing' : ''}` }),
          isPlaying ? 'Playing' : 'Ready'
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
                    'div',
                    { className: 'modal-actions' },
                    React.createElement(
                      'button',
                      { className: 'secondary-button skip-button', type: 'button', onClick: advanceAfterCompletion, disabled: isSubmittingScore },
                      'Skip score'
                    ),
                    React.createElement(
                      'button',
                      { className: 'primary-button continue-button', type: 'submit', disabled: isSubmittingScore },
                      isSubmittingScore ? 'Saving score…' : 'Continue'
                    )
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
