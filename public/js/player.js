import { apiRequest } from './api.js';
import { categoryChip } from './ui.js';

let player;
let pollTimer = null;
let screenChannel = null;
let screenWindow = null;
const POLL_INTERVAL = 5000;

const elements = {
  form: document.getElementById('access-form'),
  status: document.getElementById('status'),
  trackInfo: document.getElementById('track-info'),
  trackBadges: document.getElementById('track-badges'),
  trackTitle: document.getElementById('track-title'),
  trackMeta: document.getElementById('track-meta'),
  upcomingList: document.getElementById('upcoming-list'),
  upcomingSection: document.querySelector('.upcoming'),
  mixStrip: document.getElementById('mix-strip'),
  mixIndianCount: document.getElementById('mix-indian-count'),
  mixWesternCount: document.getElementById('mix-western-count'),
  previous: document.getElementById('previous'),
  restart: document.getElementById('restart'),
  playPause: document.getElementById('play-pause'),
  skip: document.getElementById('skip'),
  reset: document.getElementById('reset'),
  detach: document.getElementById('detach'),
  partyTitle: document.getElementById('party-title'),
  screenArea: document.getElementById('screen-area'),
  screenIdle: document.getElementById('screen-idle'),
  screenDetached: document.getElementById('screen-detached')
};

const params = new URLSearchParams(window.location.search);

const state = {
  partyId: params.get('partyId'),
  accessCode: params.get('accessCode'),
  nowPlaying: null,
  playerVideoId: null,
  isUnlocked: false,
  canGoPrevious: false,
  isPaused: false,
  endedAt: null,
  pendingAcks: [],
  handledCommands: new Set(),
  screenDetached: false,
  screenTime: 0
};

if (state.partyId) {
  elements.form.partyId.value = state.partyId;
}
if (state.accessCode) {
  elements.form.accessCode.value = state.accessCode;
}

function setStatus(message, variant = 'muted') {
  elements.status.textContent = message;
  elements.status.className = `status ${variant}`;
}

function setIdleScreen(visible) {
  elements.screenIdle.hidden = !visible || state.screenDetached;
}

/* ─── Second-screen mode ───
 * The video can be detached into a separate window (screen.html) that the
 * host drags onto a TV/projector. Controls and the queue stay in this tab;
 * the two windows sync over a BroadcastChannel keyed by party ID. */

function sendToScreen(message) {
  if (screenChannel) {
    screenChannel.postMessage(message);
  }
}

function renderScreenMode() {
  const detached = state.screenDetached;
  elements.screenArea.classList.toggle('detached', detached);
  elements.screenDetached.hidden = !detached;
  if (detached) {
    elements.screenIdle.hidden = true;
  }
  elements.detach.dataset.detached = detached ? 'true' : 'false';
  elements.detach.textContent = detached ? '🖥 Bring video back' : '🖥 Send video to 2nd screen';
}

function currentLocalTime() {
  try {
    return player ? Math.max(0, player.getCurrentTime() || 0) : 0;
  } catch (error) {
    return 0;
  }
}

function screenLoadPayload(track, start) {
  return { type: 'load', id: track.id, videoId: track.videoId, title: track.title, start: start || 0 };
}

function handleScreenMessage(data) {
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'hello': {
      // A screen window connected: hand playback over.
      const wasDetached = state.screenDetached;
      state.screenDetached = true;
      const start = wasDetached ? state.screenTime : currentLocalTime();
      if (player) {
        player.stopVideo();
      }
      if (state.nowPlaying) {
        sendToScreen(screenLoadPayload(state.nowPlaying, start));
        if (state.isPaused) sendToScreen({ type: 'pause' });
      } else {
        sendToScreen({ type: 'stop' });
      }
      renderScreenMode();
      setStatus('Video is on the second screen.', 'success');
      break;
    }
    case 'ended':
      advanceTrack();
      break;
    case 'error':
      setStatus('Video cannot be played on the screen — skipping…', 'error');
      setTimeout(() => advanceTrack(), 2500);
      break;
    case 'state':
      setPaused(!!data.paused);
      if (typeof data.currentTime === 'number') state.screenTime = data.currentTime;
      updateControlsAvailability();
      break;
    case 'time':
      if (typeof data.currentTime === 'number') state.screenTime = data.currentTime;
      break;
    case 'bye': {
      if (!state.screenDetached) break;
      state.screenDetached = false;
      screenWindow = null;
      if (typeof data.currentTime === 'number') state.screenTime = data.currentTime;
      renderScreenMode();
      // Resume locally from where the second screen left off.
      if (player && state.nowPlaying) {
        player.loadVideoById({ videoId: state.nowPlaying.videoId, startSeconds: state.screenTime });
        state.playerVideoId = state.nowPlaying.videoId;
        setPaused(false);
        setIdleScreen(false);
      } else {
        setIdleScreen(true);
      }
      setStatus('Video is back in this window.', 'success');
      break;
    }
    default:
      break;
  }
}

function ensureScreenChannel() {
  if (screenChannel || !state.partyId || typeof BroadcastChannel === 'undefined') {
    return screenChannel;
  }
  screenChannel = new BroadcastChannel(`vdojam-screen-${state.partyId}`);
  screenChannel.onmessage = ({ data }) => handleScreenMessage(data);
  return screenChannel;
}

function openSecondScreen() {
  ensureScreenChannel();
  if (!screenChannel) {
    setStatus('Your browser does not support the second-screen mode.', 'error');
    return;
  }
  const url = `/screen.html?partyId=${encodeURIComponent(state.partyId)}`;
  screenWindow = window.open(url, 'vdojamScreen', 'popup=yes,width=1280,height=720');
  if (!screenWindow) {
    setStatus('Popup blocked — allow popups for this site to use the second screen.', 'error');
  }
}

function closeSecondScreen() {
  sendToScreen({ type: 'close' });
  if (screenWindow && !screenWindow.closed) {
    try { screenWindow.close(); } catch (error) { /* opened manually */ }
  }
}

function clearPollTimer() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function ensurePoll() {
  clearPollTimer();
  pollTimer = setTimeout(() => pollState().catch(console.error), POLL_INTERVAL);
}

function setPaused(paused) {
  state.isPaused = paused;
  elements.playPause.textContent = paused ? '▶ Play' : '⏸ Pause';
}

function updateControlsAvailability() {
  const hasTrack = !!state.nowPlaying;
  elements.previous.disabled = !state.canGoPrevious || !!state.endedAt;
  elements.restart.disabled = !hasTrack || !!state.endedAt;
  elements.playPause.disabled = !hasTrack || !!state.endedAt;
  elements.skip.disabled = !hasTrack || !!state.endedAt;
  elements.reset.disabled = !state.isUnlocked || !!state.endedAt;
  elements.detach.disabled = !state.isUnlocked || !!state.endedAt;
}

function renderMixStrip(buckets) {
  if (!buckets) {
    elements.mixStrip.hidden = true;
    return;
  }
  elements.mixStrip.hidden = false;
  elements.mixIndianCount.textContent = buckets.indian ?? 0;
  elements.mixWesternCount.textContent = buckets.western ?? 0;
}

function handleEndedParty(data) {
  clearPollTimer();
  state.endedAt = data.party.endedAt || null;
  state.isUnlocked = false;
  state.nowPlaying = null;
  state.canGoPrevious = false;
  setPaused(true);
  elements.form.hidden = true;
  elements.trackInfo.hidden = false;
  elements.upcomingSection.hidden = true;
  elements.mixStrip.hidden = true;
  elements.trackBadges.innerHTML = '';
  elements.trackTitle.textContent = 'Party ended';
  elements.trackMeta.textContent = state.endedAt
    ? `This party wrapped at ${new Date(state.endedAt).toLocaleString()}.`
    : '';
  elements.upcomingList.innerHTML = '';
  setStatus('Party has ended.', 'muted');
  if (state.screenDetached) {
    sendToScreen({ type: 'stop', message: 'This party has ended. Thanks for jamming!' });
  }
  setIdleScreen(true);
  if (player) {
    player.stopVideo();
  }
  state.pendingAcks = [];
  state.handledCommands.clear();
  updateControlsAvailability();
}

async function pollState() {
  if (!state.partyId || !state.accessCode) return;
  clearPollTimer();
  try {
    const acksToSend = state.pendingAcks.length ? [...state.pendingAcks] : [];
    const data = await apiRequest(`/api/parties/${encodeURIComponent(state.partyId)}/player/state`, {
      method: 'POST',
      body: {
        accessCode: state.accessCode,
        acks: acksToSend,
        playerState: { isPaused: state.isPaused }
      }
    });
    if (acksToSend.length) {
      state.pendingAcks = state.pendingAcks.filter((id) => !acksToSend.includes(id));
      acksToSend.forEach((id) => state.handledCommands.delete(id));
    }
    state.isUnlocked = true;
    ensureScreenChannel();
    state.endedAt = data.party.endedAt || null;
    state.canGoPrevious = Boolean(data.canGoPrevious);
    elements.form.hidden = true;
    elements.trackInfo.hidden = false;
    elements.partyTitle.textContent = data.party.name;
    document.title = `${data.party.name} — VDOjam Player`;
    if (state.endedAt) {
      handleEndedParty(data);
      return;
    }
    elements.upcomingSection.hidden = false;
    renderMixStrip(data.buckets);
    setStatus(data.nowPlaying ? 'Streaming the live mix' : 'Waiting for new tracks…', 'success');
    updateTrack(data.nowPlaying);
    renderUpcoming(data.upcoming || []);
    updateControlsAvailability();
    if (Array.isArray(data.commands)) {
      processCommands(data.commands);
    }
    ensurePoll();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
    state.isUnlocked = false;
    state.endedAt = null;
    state.canGoPrevious = false;
    elements.form.hidden = false;
    elements.trackInfo.hidden = true;
    elements.upcomingSection.hidden = true;
    elements.mixStrip.hidden = true;
    updateControlsAvailability();
    if (error.status !== 403 && error.status !== 404) {
      ensurePoll();
    }
  }
}

function renderUpcoming(list) {
  elements.upcomingList.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = 'Queue is empty — ask guests to add songs.';
    elements.upcomingList.appendChild(li);
    return;
  }
  list.slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    li.dataset.category = item.category;
    const title = document.createElement('span');
    title.className = 'up-title';
    title.textContent = `${item.title} — ${item.submittedBy}`;
    li.append(title, categoryChip(item));
    elements.upcomingList.appendChild(li);
  });
}

function updateTrack(track) {
  if (!track) {
    state.nowPlaying = null;
    state.playerVideoId = null;
    elements.trackBadges.innerHTML = '';
    elements.trackTitle.textContent = 'No track playing';
    elements.trackMeta.textContent = '';
    setPaused(true);
    setIdleScreen(true);
    if (state.screenDetached) {
      sendToScreen({ type: 'stop' });
    } else if (player) {
      player.stopVideo();
    }
    return;
  }
  const isNewTrack = !state.nowPlaying || state.nowPlaying.id !== track.id;
  const needsLoad = isNewTrack || state.playerVideoId !== track.videoId;
  state.nowPlaying = track;
  elements.trackBadges.innerHTML = '';
  elements.trackBadges.appendChild(categoryChip(track));
  elements.trackTitle.textContent = track.title;
  elements.trackMeta.textContent = `by ${track.channel} · added by ${track.submittedBy}`;
  setIdleScreen(false);
  if (needsLoad) {
    if (state.screenDetached) {
      state.screenTime = 0;
      sendToScreen(screenLoadPayload(track));
    } else if (player) {
      player.loadVideoById(track.videoId);
    }
    state.playerVideoId = track.videoId;
    setPaused(false);
  }
}

function processCommands(commands) {
  commands.forEach((command) => {
    if (!command || !command.id || state.handledCommands.has(command.id)) {
      return;
    }
    const executed = executeCommand(command);
    if (executed) {
      state.handledCommands.add(command.id);
      if (!state.pendingAcks.includes(command.id)) {
        state.pendingAcks.push(command.id);
      }
    }
  });
}

function executeCommand(command) {
  if (state.endedAt) {
    return true;
  }
  const action = command.action;
  if (action === 'restart') {
    if (!state.nowPlaying) {
      return true;
    }
    if (!player && !state.screenDetached) {
      return false;
    }
    return restartTrack();
  }
  if (action === 'pause') {
    if (state.screenDetached) {
      sendToScreen({ type: 'pause' });
      return true;
    }
    if (!player) return false;
    player.pauseVideo();
    return true;
  }
  if (action === 'play') {
    if (state.screenDetached) {
      sendToScreen({ type: 'play' });
      return true;
    }
    if (!player) return false;
    player.playVideo();
    return true;
  }
  return true;
}

async function advanceTrack() {
  if (!state.nowPlaying || state.endedAt) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(state.partyId)}/player/advance`, {
      method: 'POST',
      body: {
        accessCode: state.accessCode,
        submissionId: state.nowPlaying.id
      }
    });
    await pollState();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
    ensurePoll();
  }
}

async function goToPrevious() {
  if (!state.partyId || !state.accessCode || state.endedAt) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(state.partyId)}/player/previous`, {
      method: 'POST',
      body: { accessCode: state.accessCode }
    });
    await pollState();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  }
}

function restartTrack() {
  if (!state.nowPlaying || state.endedAt) return false;
  if (state.screenDetached) {
    sendToScreen({ type: 'restart' });
    setPaused(false);
    updateControlsAvailability();
    return true;
  }
  if (!player) return false;
  player.seekTo(0, true);
  player.playVideo();
  setPaused(false);
  updateControlsAvailability();
  return true;
}

function togglePlayback() {
  if (!state.nowPlaying || state.endedAt) return;
  if (state.screenDetached) {
    const targetPaused = !state.isPaused;
    sendToScreen({ type: targetPaused ? 'pause' : 'play' });
    setPaused(targetPaused);
    return;
  }
  if (!player) return;
  if (state.isPaused) {
    player.playVideo();
  } else {
    player.pauseVideo();
  }
}

async function resetQueue() {
  if (!state.partyId || !state.accessCode || state.endedAt) return;
  if (!confirm('Reset the queue? All tracks will be marked as unplayed.')) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(state.partyId)}/player/reset`, {
      method: 'POST',
      body: { accessCode: state.accessCode }
    });
    await pollState();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  state.partyId = formData.get('partyId').trim();
  state.accessCode = formData.get('accessCode').trim();
  setStatus('Connecting to party…', 'muted');
  pollState();
});

elements.previous.addEventListener('click', goToPrevious);
elements.restart.addEventListener('click', restartTrack);
elements.playPause.addEventListener('click', togglePlayback);
elements.skip.addEventListener('click', advanceTrack);
elements.reset.addEventListener('click', resetQueue);

elements.detach.addEventListener('click', () => {
  if (state.screenDetached) {
    closeSecondScreen();
  } else {
    openSecondScreen();
  }
});

window.addEventListener('pagehide', () => {
  if (state.screenDetached) {
    closeSecondScreen();
  }
});

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '390',
    width: '640',
    playerVars: { rel: 0 },
    events: {
      onReady: () => {
        if (state.partyId && state.accessCode) {
          pollState();
        }
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          advanceTrack();
        }
        if (event.data === YT.PlayerState.PAUSED) {
          setPaused(true);
          updateControlsAvailability();
        }
        if (event.data === YT.PlayerState.PLAYING) {
          setPaused(false);
          updateControlsAvailability();
        }
      },
      onError: () => {
        // Unplayable/embedded-restricted video: skip after a short pause so
        // the party is not stuck on a dead track.
        setStatus('Video cannot be played here — skipping…', 'error');
        setTimeout(() => advanceTrack(), 2500);
      }
    }
  });
}

window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

updateControlsAvailability();
renderScreenMode();
setIdleScreen(true);
