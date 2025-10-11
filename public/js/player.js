import { apiRequest } from './api.js';

let player;
let pollTimer = null;
const POLL_INTERVAL = 5000;

const elements = {
  form: document.getElementById('access-form'),
  status: document.getElementById('status'),
  trackInfo: document.getElementById('track-info'),
  trackTitle: document.getElementById('track-title'),
  trackMeta: document.getElementById('track-meta'),
  upcomingList: document.getElementById('upcoming-list'),
  upcomingSection: document.querySelector('.upcoming'),
  skip: document.getElementById('skip'),
  reset: document.getElementById('reset'),
  partyTitle: document.getElementById('party-title')
};

const params = new URLSearchParams(window.location.search);

const state = {
  partyId: params.get('partyId'),
  accessCode: params.get('accessCode'),
  nowPlaying: null,
  isUnlocked: false
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

function ensurePoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  pollTimer = setTimeout(() => pollState().catch(console.error), POLL_INTERVAL);
}

async function pollState() {
  if (!state.partyId || !state.accessCode) return;
  try {
    const data = await apiRequest(`/api/parties/${encodeURIComponent(state.partyId)}/player/state`, {
      method: 'POST',
      body: { accessCode: state.accessCode }
    });
    state.isUnlocked = true;
    elements.form.hidden = true;
    elements.trackInfo.hidden = false;
    elements.upcomingSection.hidden = false;
    elements.partyTitle.textContent = `${data.party.name} • Player`;
    setStatus(data.nowPlaying ? 'Streaming live queue' : 'Waiting for new tracks…', 'success');
    updateTrack(data.nowPlaying);
    renderUpcoming(data.upcoming || []);
    ensurePoll();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
    state.isUnlocked = false;
    elements.form.hidden = false;
    elements.trackInfo.hidden = true;
    elements.upcomingSection.hidden = true;
  }
}

function renderUpcoming(list) {
  elements.upcomingList.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = 'Queue is empty.';
    elements.upcomingList.appendChild(li);
    return;
  }
  list.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.title} — submitted by ${item.submittedBy}`;
    elements.upcomingList.appendChild(li);
  });
}

function updateTrack(track) {
  if (!track) {
    state.nowPlaying = null;
    elements.trackTitle.textContent = 'No track playing';
    elements.trackMeta.textContent = '';
    elements.skip.disabled = true;
    if (player) {
      player.stopVideo();
    }
    return;
  }
  if (!state.nowPlaying || state.nowPlaying.id !== track.id) {
    state.nowPlaying = track;
    elements.trackTitle.textContent = track.title;
    elements.trackMeta.textContent = `by ${track.channel} • submitted by ${track.submittedBy}`;
    if (player) {
      player.loadVideoById(track.videoId);
    }
  }
  elements.skip.disabled = false;
}

async function advanceTrack() {
  if (!state.nowPlaying) return;
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
  }
}

async function resetQueue() {
  if (!state.partyId || !state.accessCode) return;
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

elements.skip.addEventListener('click', () => {
  advanceTrack();
});

elements.reset.addEventListener('click', () => {
  resetQueue();
});

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '390',
    width: '640',
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
      }
    }
  });
}

window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
