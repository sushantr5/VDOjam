import { apiRequest } from './api.js';
import { loadSessions, updateSession, deleteSession } from './storage.js';

const params = new URLSearchParams(window.location.search);
const partyId = params.get('partyId');

if (!partyId) {
  window.location.replace('/');
}

const REFRESH_INTERVAL = 8000;
let refreshTimer = null;

const elements = {
  partyName: document.getElementById('party-name'),
  partyId: document.getElementById('party-id'),
  accessCode: document.getElementById('access-code'),
  shareLink: document.getElementById('share-link'),
  shareQr: document.getElementById('share-qr'),
  queueList: document.getElementById('queue-list'),
  composer: document.getElementById('composer'),
  remainingCount: document.getElementById('remaining-count'),
  videoForm: document.getElementById('video-form'),
  adminControls: document.getElementById('admin-controls'),
  openPlayer: document.getElementById('open-player'),
  sessionDetails: document.getElementById('session-details'),
  logout: document.getElementById('logout'),
  overlay: document.getElementById('join-overlay'),
  overlayForm: document.getElementById('overlay-form'),
  overlayCancel: document.getElementById('overlay-cancel'),
  overlayPartyName: document.getElementById('overlay-party-name'),
  trackTemplate: document.getElementById('track-template')
};

const sessions = loadSessions();
let session = sessions[partyId] || null;
let state = {
  token: session?.authToken || null,
  user: null,
  party: null,
  submissions: [],
  remainingUploads: null,
  nowPlaying: null
};

function setOverlay(visible) {
  elements.overlay.hidden = !visible;
}

function ensureRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => refreshState().catch(console.error), REFRESH_INTERVAL);
}

function renderSessionDetails() {
  if (!state.user) {
    elements.sessionDetails.hidden = true;
    return;
  }
  elements.sessionDetails.hidden = false;
  elements.sessionDetails.innerHTML = `Logged in as <strong>${state.user.name}</strong> (${state.user.role})`;
}

function renderPartyInfo() {
  if (!state.party) return;
  elements.partyName.textContent = state.party.name;
  elements.partyId.textContent = partyId;
  elements.shareLink.innerHTML = `<a href="${state.party.joinUrl}">${state.party.joinUrl}</a>`;
  elements.shareQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(state.party.joinUrl)}`;
  elements.shareQr.hidden = false;
  if (state.user?.role === 'admin' && state.party.accessCode) {
    elements.accessCode.textContent = `Player access code: ${state.party.accessCode}`;
    elements.accessCode.hidden = false;
    elements.adminControls.hidden = false;
    elements.openPlayer.href = `/player.html?partyId=${encodeURIComponent(partyId)}&accessCode=${encodeURIComponent(state.party.accessCode)}`;
  } else {
    elements.accessCode.hidden = true;
    elements.adminControls.hidden = true;
  }
  elements.overlayPartyName.textContent = `Join "${state.party.name}" with a display name.`;
}

function renderComposer() {
  if (!state.user) {
    elements.composer.hidden = true;
    return;
  }
  elements.composer.hidden = false;
  if (typeof state.remainingUploads === 'number') {
    elements.remainingCount.textContent = state.remainingUploads;
  }
  elements.videoForm.querySelector('button').disabled = state.remainingUploads === 0;
}

function formatSubmittedText(track) {
  const submitted = new Date(track.submittedAt);
  const formatted = submitted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Submitted by ${track.submittedBy} • ${formatted}`;
}

function renderQueue() {
  elements.queueList.innerHTML = '';
  if (!state.submissions.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No songs in the queue yet. Paste a YouTube link to start the party!';
    elements.queueList.appendChild(empty);
    return;
  }
  state.submissions.forEach((track) => {
    const node = elements.trackTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.thumb').src = track.thumbnail;
    node.querySelector('.title').textContent = track.title;
    node.querySelector('.meta').textContent = `by ${track.channel}`;
    node.querySelector('.submitted').textContent = formatSubmittedText(track);
    node.querySelector('.score').textContent = track.score;
    if (track.played) {
      node.classList.add('played');
    }
    if (state.nowPlaying && state.nowPlaying.id === track.id && !track.played) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Now playing';
      node.querySelector('header').appendChild(badge);
    }
    node.querySelectorAll('.vote').forEach((voteBtn) => {
      const value = Number(voteBtn.dataset.vote);
      if (track.viewerVote === value) {
        voteBtn.dataset.state = 'active';
      } else {
        voteBtn.removeAttribute('data-state');
      }
      voteBtn.addEventListener('click', () => handleVote(track.id, value === track.viewerVote ? 0 : value));
    });

    const buttons = node.querySelector('.track-buttons');
    if (state.user?.role === 'admin') {
      const promote = document.createElement('button');
      promote.textContent = 'Play next';
      promote.addEventListener('click', () => promoteTrack(track.id));
      buttons.appendChild(promote);
      const markPlayed = document.createElement('button');
      markPlayed.textContent = 'Mark played';
      markPlayed.addEventListener('click', () => markPlayedTrack(track.id));
      buttons.appendChild(markPlayed);
    }
    if (state.user && (state.user.role === 'admin' || state.user.id === track.submittedById)) {
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.classList.add('danger');
      remove.addEventListener('click', () => removeTrack(track.id));
      buttons.appendChild(remove);
    }

    elements.queueList.appendChild(node);
  });
}

async function refreshState() {
  try {
    const data = await apiRequest(`/api/parties/${encodeURIComponent(partyId)}`, {
      token: state.token
    });
    state = {
      ...state,
      party: data.party,
      user: data.user || state.user,
      submissions: data.submissions,
      remainingUploads: data.remainingUploads ?? state.remainingUploads,
      nowPlaying: data.nowPlaying
    };
    if (data.user) {
      session = updateSession(partyId, {
        authToken: state.token,
        userId: data.user.id,
        userName: data.user.name,
        role: data.user.role,
        partyName: data.party.name,
        updatedAt: Date.now()
      });
    }
    renderPartyInfo();
    renderSessionDetails();
    renderComposer();
    renderQueue();
    if (!state.token) {
      setOverlay(true);
    } else {
      setOverlay(false);
    }
    ensureRefreshTimer();
  } catch (error) {
    console.error('Failed to refresh state', error);
    if (error.status === 401 || error.status === 403) {
      if (session) {
        deleteSession(partyId);
      }
      session = null;
      state.token = null;
      state.user = null;
      renderComposer();
      renderSessionDetails();
      setOverlay(true);
    }
  }
}

async function handleVote(trackId, value) {
  if (!state.token) {
    setOverlay(true);
    return;
  }
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}/vote`, {
      method: 'POST',
      token: state.token,
      body: { value }
    });
    await refreshState();
  } catch (error) {
    console.error(error);
  }
}

async function removeTrack(trackId) {
  if (!state.token) return;
  if (!confirm('Remove this track from the queue?')) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
      token: state.token
    });
    await refreshState();
  } catch (error) {
    console.error(error);
  }
}

async function promoteTrack(trackId) {
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}/promote`, {
      method: 'POST',
      token: state.token
    });
    await refreshState();
  } catch (error) {
    console.error(error);
  }
}

async function markPlayedTrack(trackId) {
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}/mark-played`, {
      method: 'POST',
      token: state.token
    });
    await refreshState();
  } catch (error) {
    console.error(error);
  }
}

elements.videoForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) {
    setOverlay(true);
    return;
  }
  const formData = Object.fromEntries(new FormData(elements.videoForm));
  elements.videoForm.querySelector('button').disabled = true;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos`, {
      method: 'POST',
      token: state.token,
      body: formData
    });
    elements.videoForm.reset();
    await refreshState();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    elements.videoForm.querySelector('button').disabled = false;
  }
});

elements.logout?.addEventListener('click', () => {
  if (session) {
    deleteSession(partyId);
  }
  window.location.href = '/';
});

elements.overlayForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = elements.overlayForm.displayName.value.trim();
  if (!value) return;
  elements.overlayForm.querySelector('button').disabled = true;
  try {
    const result = await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/join`, {
      method: 'POST',
      body: { displayName: value }
    });
    state.token = result.authToken;
    session = updateSession(partyId, {
      authToken: result.authToken,
      userId: result.user.id,
      userName: result.user.name,
      role: result.user.role,
      partyName: result.party.name,
      updatedAt: Date.now()
    });
    setOverlay(false);
    await refreshState();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    elements.overlayForm.querySelector('button').disabled = false;
  }
});

elements.overlayCancel?.addEventListener('click', () => {
  window.location.href = '/';
});

refreshState();
