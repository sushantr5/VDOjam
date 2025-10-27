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
  endParty: document.getElementById('end-party'),
  adminPrevious: document.getElementById('admin-previous'),
  adminRestart: document.getElementById('admin-restart'),
  adminPlayPause: document.getElementById('admin-play-pause'),
  adminNext: document.getElementById('admin-next'),
  sessionDetails: document.getElementById('session-details'),
  logout: document.getElementById('logout'),
  overlay: document.getElementById('join-overlay'),
  overlayTitle: document.querySelector('#join-overlay h2'),
  overlayForm: document.getElementById('overlay-form'),
  overlayCancel: document.getElementById('overlay-cancel'),
  overlayPartyName: document.getElementById('overlay-party-name'),
  partyStatus: document.getElementById('party-status'),
  nowPlayingCard: document.getElementById('now-playing'),
  nowPlayingTrack: document.getElementById('now-playing-track'),
  nowPlayingThumb: document.getElementById('now-playing-thumb'),
  nowPlayingTitle: document.getElementById('now-playing-title'),
  nowPlayingMeta: document.getElementById('now-playing-meta'),
  nowPlayingSubmitted: document.getElementById('now-playing-submitted'),
  nowPlayingEmpty: document.getElementById('now-playing-empty'),
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
  nowPlaying: null,
  history: [],
  playerState: { isPaused: false }
};

function setOverlay(visible) {
  elements.overlay.hidden = !visible;
}

function updateOverlayContent() {
  if (!state.party) return;
  if (state.party.endedAt) {
    if (elements.overlayTitle) {
      elements.overlayTitle.textContent = 'Party ended';
    }
    elements.overlayPartyName.textContent = `“${state.party.name}” has wrapped up. Thanks for jamming!`;
    elements.overlayForm.hidden = true;
    elements.overlayCancel.textContent = 'Return home';
  } else {
    if (elements.overlayTitle) {
      elements.overlayTitle.textContent = 'Join this party';
    }
    elements.overlayPartyName.textContent = `Join "${state.party.name}" with a display name.`;
    elements.overlayForm.hidden = false;
    elements.overlayCancel.textContent = 'Return home';
  }
}

function renderPartyStatus() {
  if (!elements.partyStatus) return;
  if (!state.party) {
    elements.partyStatus.hidden = true;
    elements.partyStatus.removeAttribute('data-state');
    elements.partyStatus.textContent = '';
    return;
  }
  if (state.party.endedAt) {
    const ended = new Date(state.party.endedAt).toLocaleString();
    elements.partyStatus.hidden = false;
    elements.partyStatus.dataset.state = 'ended';
    elements.partyStatus.innerHTML = `<strong>Party ended</strong><p class="muted">This party wrapped at ${ended}. Thanks for jamming with us!</p>`;
  } else {
    elements.partyStatus.hidden = true;
    elements.partyStatus.removeAttribute('data-state');
    elements.partyStatus.textContent = '';
  }
}

function renderNowPlaying() {
  if (!elements.nowPlayingCard) return;
  if (!state.party || state.party.endedAt) {
    elements.nowPlayingCard.hidden = true;
    return;
  }
  elements.nowPlayingCard.hidden = false;
  if (!state.nowPlaying) {
    elements.nowPlayingTrack.hidden = true;
    elements.nowPlayingEmpty.hidden = false;
    if (state.submissions.length) {
      elements.nowPlayingEmpty.textContent = 'Waiting for the next track to begin.';
    } else {
      elements.nowPlayingEmpty.textContent = 'Queue is waiting for its first track.';
    }
    elements.nowPlayingThumb?.removeAttribute('src');
    elements.nowPlayingTitle.textContent = '';
    elements.nowPlayingMeta.textContent = '';
    elements.nowPlayingSubmitted.textContent = '';
    return;
  }
  elements.nowPlayingTrack.hidden = false;
  elements.nowPlayingEmpty.hidden = true;
  elements.nowPlayingThumb.src = state.nowPlaying.thumbnail;
  elements.nowPlayingThumb.alt = `Thumbnail for ${state.nowPlaying.title}`;
  elements.nowPlayingTitle.textContent = state.nowPlaying.title;
  elements.nowPlayingMeta.textContent = `by ${state.nowPlaying.channel}`;
  elements.nowPlayingSubmitted.textContent = formatSubmittedText(state.nowPlaying);
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
    if (elements.logout) {
      elements.logout.hidden = true;
    }
    return;
  }
  elements.sessionDetails.hidden = false;
  elements.sessionDetails.innerHTML = `Logged in as <strong>${state.user.name}</strong> (${state.user.role})`;
  if (elements.logout) {
    elements.logout.hidden = false;
  }
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
    if (elements.endParty) {
      elements.endParty.disabled = !!state.party.endedAt;
      elements.endParty.textContent = state.party.endedAt ? 'Party ended' : 'End party';
    }
  } else {
    elements.accessCode.hidden = true;
    elements.adminControls.hidden = true;
  }
  renderAdminControls();
  updateOverlayContent();
  renderPartyStatus();
}

function renderAdminControls() {
  const isAdmin = state.user?.role === 'admin';
  const partyEnded = !!state.party?.endedAt;
  const hasTrack = !!state.nowPlaying;
  const historyCount = Array.isArray(state.history) ? state.history.length : 0;
  if (elements.adminPrevious) {
    elements.adminPrevious.disabled = !isAdmin || partyEnded || historyCount === 0;
  }
  if (elements.adminRestart) {
    elements.adminRestart.disabled = !isAdmin || partyEnded || !hasTrack;
  }
  if (elements.adminNext) {
    elements.adminNext.disabled = !isAdmin || partyEnded || !hasTrack;
  }
  if (elements.adminPlayPause) {
    elements.adminPlayPause.disabled = !isAdmin || partyEnded || !hasTrack;
    const isPaused = !!state.playerState?.isPaused;
    elements.adminPlayPause.textContent = isPaused ? 'Play' : 'Pause';
  }
}

function renderComposer() {
  if (!state.user || state.party?.endedAt) {
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
  const partyEnded = !!state.party?.endedAt;
  const upcoming = state.submissions;
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    if (partyEnded) {
      empty.textContent = 'This party has ended and the queue is now closed.';
    } else if (state.nowPlaying) {
      empty.textContent = 'No songs queued after this one. Add more tracks to keep the party going!';
    } else {
      empty.textContent = 'No songs in the queue yet. Paste a YouTube link to start the party!';
    }
    elements.queueList.appendChild(empty);
    return;
  }
  upcoming.forEach((track) => {
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
      const votingDisabled = partyEnded || (state.nowPlaying && state.nowPlaying.id === track.id && !track.played);
      if (votingDisabled) {
        voteBtn.dataset.disabled = 'true';
        voteBtn.removeAttribute('data-state');
      } else {
        delete voteBtn.dataset.disabled;
        if (track.viewerVote === value) {
          voteBtn.dataset.state = 'active';
        } else {
          voteBtn.removeAttribute('data-state');
        }
      }
      voteBtn.addEventListener('click', () => {
        if (votingDisabled) return;
        handleVote(track.id, value === track.viewerVote ? 0 : value);
      });
    });

    const buttons = node.querySelector('.track-buttons');
    if (!partyEnded) {
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
      nowPlaying: data.nowPlaying,
      history: data.history || [],
      playerState: data.playerState || state.playerState
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
    renderNowPlaying();
    renderQueue();
    renderAdminControls();
    if (!state.token) {
      setOverlay(true);
    } else {
      setOverlay(false);
    }
    if (state.party?.endedAt) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    } else {
      ensureRefreshTimer();
    }
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

async function sendPlayerControl(action) {
  if (!state.token || state.user?.role !== 'admin') return false;
  if (state.party?.endedAt) return false;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/player/control`, {
      method: 'POST',
      token: state.token,
      body: { action }
    });
    return true;
  } catch (error) {
    console.error(error);
    alert(error.message);
    return false;
  }
}

async function goToPreviousTrack() {
  if (!state.party?.accessCode || state.party?.endedAt) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/player/previous`, {
      method: 'POST',
      body: { accessCode: state.party.accessCode }
    });
    await refreshState();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

async function goToNextTrack() {
  if (!state.party?.accessCode || state.party?.endedAt || !state.nowPlaying) return;
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/player/advance`, {
      method: 'POST',
      body: {
        accessCode: state.party.accessCode,
        submissionId: state.nowPlaying.id
      }
    });
    await refreshState();
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

async function restartPlayerTrack() {
  if (!state.nowPlaying || state.party?.endedAt) return;
  const result = await sendPlayerControl('restart');
  if (result) {
    state.playerState = { ...state.playerState, isPaused: false };
    renderAdminControls();
  }
}

async function togglePlayerPlayback() {
  if (!state.nowPlaying || state.party?.endedAt) return;
  const targetAction = state.playerState?.isPaused ? 'play' : 'pause';
  const result = await sendPlayerControl(targetAction);
  if (result) {
    state.playerState = { ...state.playerState, isPaused: targetAction === 'pause' };
    renderAdminControls();
  }
}

async function endCurrentParty() {
  if (!state.token || !state.user || state.user.role !== 'admin') return;
  if (state.party?.endedAt) return;
  if (!confirm('End this party? Guests will no longer be able to join and the queue will be locked.')) return;
  if (elements.endParty) {
    elements.endParty.disabled = true;
  }
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/end`, {
      method: 'POST',
      token: state.token
    });
    if (session) {
      deleteSession(partyId);
      session = null;
    }
    state.token = null;
    window.location.href = '/';
  } catch (error) {
    console.error(error);
    alert(error.message);
    if (elements.endParty) {
      elements.endParty.disabled = false;
    }
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

elements.endParty?.addEventListener('click', () => {
  endCurrentParty();
});

elements.logout?.addEventListener('click', () => {
  if (session) {
    deleteSession(partyId);
  }
  window.location.href = '/';
});

elements.overlayForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.party?.endedAt) {
    alert('This party has already ended.');
    return;
  }
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

elements.adminPrevious?.addEventListener('click', () => {
  goToPreviousTrack();
});

elements.adminNext?.addEventListener('click', () => {
  goToNextTrack();
});

elements.adminRestart?.addEventListener('click', () => {
  restartPlayerTrack();
});

elements.adminPlayPause?.addEventListener('click', () => {
  togglePlayerPlayback();
});

refreshState();
