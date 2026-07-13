import { apiRequest } from './api.js';
import { categoryChip } from './ui.js';

let player;
let pollTimer = null;
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
  partyTitle: document.getElementById('party-title'),
  screenIdle: document.getElementById('screen-idle')
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
  handledCommands: new Set()
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
  elements.screenIdle.hidden = !visible;
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
    if (player) {
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
  if (player && needsLoad) {
    player.loadVideoById(track.videoId);
    state.playerVideoId = track.videoId;
  }
  if (needsLoad) {
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
    if (!player) {
      return false;
    }
    return restartTrack();
  }
  if (action === 'pause') {
    if (!player) return false;
    player.pauseVideo();
    return true;
  }
  if (action === 'play') {
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
  if (!player || !state.nowPlaying || state.endedAt) return false;
  player.seekTo(0, true);
  player.playVideo();
  setPaused(false);
  updateControlsAvailability();
  return true;
}

function togglePlayback() {
  if (!player || !state.nowPlaying || state.endedAt) return;
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
setIdleScreen(true);
