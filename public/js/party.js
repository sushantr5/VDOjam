import { apiRequest } from './api.js';
import { loadSessions, updateSession, deleteSession } from './storage.js';
import { showToast, categoryChip, categoryLabel, formatTime } from './ui.js';

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
  copyLink: document.getElementById('copy-link'),
  shareQr: document.getElementById('share-qr'),
  queueList: document.getElementById('queue-list'),
  composer: document.getElementById('composer'),
  composerButton: document.getElementById('composer-button'),
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
  mixMeter: document.getElementById('mix-meter'),
  aiBadge: document.getElementById('ai-badge'),
  bucketIndian: document.getElementById('bucket-indian'),
  bucketWestern: document.getElementById('bucket-western'),
  bucketIndianCount: document.getElementById('bucket-indian-count'),
  bucketWesternCount: document.getElementById('bucket-western-count'),
  mixBarIndian: document.getElementById('mix-bar-indian'),
  mixNext: document.getElementById('mix-next'),
  nowPlayingCard: document.getElementById('now-playing'),
  nowPlayingChip: document.getElementById('now-playing-chip'),
  nowPlayingTrack: document.getElementById('now-playing-track'),
  nowPlayingThumb: document.getElementById('now-playing-thumb'),
  nowPlayingBadges: document.getElementById('now-playing-badges'),
  nowPlayingTitle: document.getElementById('now-playing-title'),
  nowPlayingMeta: document.getElementById('now-playing-meta'),
  nowPlayingSubmitted: document.getElementById('now-playing-submitted'),
  nowPlayingEmpty: document.getElementById('now-playing-empty'),
  historyCard: document.getElementById('history-card'),
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
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
  buckets: null,
  aiEnabled: false,
  playerState: { isPaused: false }
};

function setOverlay(visible) {
  elements.overlay.hidden = !visible;
}

function updateOverlayContent() {
  if (!state.party) return;
  if (state.party.endedAt) {
    elements.overlayTitle.textContent = 'Party ended';
    elements.overlayPartyName.textContent = `“${state.party.name}” has wrapped up. Thanks for jamming!`;
    elements.overlayForm.hidden = true;
  } else {
    elements.overlayTitle.textContent = 'Join this party';
    elements.overlayPartyName.textContent = `Join “${state.party.name}” with a display name.`;
    elements.overlayForm.hidden = false;
  }
}

function renderPartyStatus() {
  if (!state.party || !state.party.endedAt) {
    elements.partyStatus.hidden = true;
    elements.partyStatus.removeAttribute('data-state');
    elements.partyStatus.textContent = '';
    return;
  }
  const ended = new Date(state.party.endedAt).toLocaleString();
  elements.partyStatus.hidden = false;
  elements.partyStatus.dataset.state = 'ended';
  elements.partyStatus.innerHTML = `<strong>Party ended</strong><p class="muted">This party wrapped at ${ended}. Thanks for jamming with us!</p>`;
}

function renderMixMeter() {
  if (!state.buckets || state.party?.endedAt) {
    elements.mixMeter.hidden = true;
    return;
  }
  elements.mixMeter.hidden = false;
  const indian = state.buckets.indian || 0;
  const western = state.buckets.western || 0;
  elements.bucketIndianCount.textContent = indian;
  elements.bucketWesternCount.textContent = western;
  const total = indian + western;
  elements.mixBarIndian.style.width = total ? `${Math.round((indian / total) * 100)}%` : '50%';

  elements.aiBadge.textContent = state.aiEnabled ? 'AI mix' : 'Auto mix';
  elements.aiBadge.title = state.aiEnabled
    ? 'Songs are classified by an LLM when added; the player alternates between buckets.'
    : 'Songs are auto-detected by keyword and script analysis; the player alternates between buckets.';

  const nextCategory = state.nowPlaying
    ? (state.nowPlaying.category === 'indian' ? 'western' : 'indian')
    : state.buckets.nextCategory;
  elements.bucketIndian.classList.toggle('up-next', nextCategory === 'indian' && indian > 0);
  elements.bucketWestern.classList.toggle('up-next', nextCategory === 'western' && western > 0);
}

function renderNowPlaying() {
  if (!state.party || state.party.endedAt) {
    elements.nowPlayingCard.hidden = true;
    return;
  }
  elements.nowPlayingCard.hidden = false;
  if (!state.nowPlaying) {
    elements.nowPlayingTrack.hidden = true;
    elements.nowPlayingChip.hidden = true;
    elements.nowPlayingEmpty.hidden = false;
    elements.nowPlayingEmpty.textContent = state.submissions.length
      ? 'Waiting for the next track to begin.'
      : 'Queue is waiting for its first track.';
    elements.nowPlayingThumb.removeAttribute('src');
    elements.nowPlayingBadges.innerHTML = '';
    elements.nowPlayingTitle.textContent = '';
    elements.nowPlayingMeta.textContent = '';
    elements.nowPlayingSubmitted.textContent = '';
    return;
  }
  elements.nowPlayingTrack.hidden = false;
  elements.nowPlayingChip.hidden = false;
  elements.nowPlayingEmpty.hidden = true;
  elements.nowPlayingThumb.src = state.nowPlaying.thumbnail;
  elements.nowPlayingThumb.alt = `Thumbnail for ${state.nowPlaying.title}`;
  elements.nowPlayingBadges.innerHTML = '';
  elements.nowPlayingBadges.appendChild(categoryChip(state.nowPlaying));
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
    elements.logout.hidden = true;
    return;
  }
  elements.sessionDetails.hidden = false;
  elements.sessionDetails.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = state.user.name;
  elements.sessionDetails.append('Signed in as ', strong, ` · ${state.user.role}`);
  elements.logout.hidden = false;
}

function renderPartyInfo() {
  if (!state.party) return;
  document.title = `${state.party.name} — VDOjam`;
  elements.partyName.textContent = state.party.name;
  elements.partyId.textContent = partyId;
  elements.shareLink.innerHTML = '';
  const link = document.createElement('a');
  link.href = state.party.joinUrl;
  link.textContent = state.party.joinUrl;
  elements.shareLink.appendChild(link);
  elements.copyLink.hidden = false;
  elements.shareQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(state.party.joinUrl)}`;
  elements.shareQr.hidden = false;
  if (state.user?.role === 'admin' && state.party.accessCode) {
    elements.accessCode.textContent = `Player access code: ${state.party.accessCode}`;
    elements.accessCode.hidden = false;
    elements.adminControls.hidden = false;
    elements.openPlayer.href = `/player.html?partyId=${encodeURIComponent(partyId)}&accessCode=${encodeURIComponent(state.party.accessCode)}`;
    elements.endParty.disabled = !!state.party.endedAt;
    elements.endParty.textContent = state.party.endedAt ? 'Party ended' : 'End party';
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
  elements.adminPrevious.disabled = !isAdmin || partyEnded || historyCount === 0;
  elements.adminRestart.disabled = !isAdmin || partyEnded || !hasTrack;
  elements.adminNext.disabled = !isAdmin || partyEnded || !hasTrack;
  elements.adminPlayPause.disabled = !isAdmin || partyEnded || !hasTrack;
  elements.adminPlayPause.textContent = state.playerState?.isPaused ? '▶ Play' : '⏸ Pause';
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
  elements.composerButton.disabled = state.remainingUploads === 0;
}

function formatSubmittedText(track) {
  return `Added by ${track.submittedBy} · ${formatTime(track.submittedAt)}`;
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
  upcoming.forEach((track, index) => {
    const node = elements.trackTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.category = track.category;
    node.querySelector('.track-order').textContent = index + 1;
    node.querySelector('.thumb').src = track.thumbnail;
    node.querySelector('.title').textContent = track.title;
    node.querySelector('.meta').textContent = `by ${track.channel}`;
    node.querySelector('.submitted').textContent = formatSubmittedText(track);
    node.querySelector('.score').textContent = track.score;

    const badges = node.querySelector('.track-badges');
    badges.appendChild(categoryChip(track));
    if (track.priority > 0) {
      const boost = document.createElement('span');
      boost.className = 'chip';
      boost.textContent = 'Boosted';
      boost.title = 'An admin promoted this track to play next in its bucket.';
      badges.appendChild(boost);
    }

    node.querySelectorAll('.vote').forEach((voteBtn) => {
      const value = Number(voteBtn.dataset.vote);
      const votingDisabled = partyEnded || !state.user;
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
        promote.textContent = '⚡ Play next';
        promote.title = 'Boost this track to the top of its bucket.';
        promote.addEventListener('click', () => promoteTrack(track.id));
        buttons.appendChild(promote);

        const recategorize = document.createElement('button');
        const target = track.category === 'indian' ? 'western' : 'indian';
        recategorize.textContent = `→ ${categoryLabel(target)} bucket`;
        recategorize.title = 'Move this song to the other bucket if the AI got it wrong.';
        recategorize.addEventListener('click', () => setCategory(track.id, target));
        buttons.appendChild(recategorize);

        const markPlayedBtn = document.createElement('button');
        markPlayedBtn.textContent = 'Mark played';
        markPlayedBtn.addEventListener('click', () => markPlayedTrack(track.id));
        buttons.appendChild(markPlayedBtn);
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

function renderHistory() {
  const history = state.history || [];
  if (!history.length) {
    elements.historyCard.hidden = true;
    return;
  }
  elements.historyCard.hidden = false;
  elements.historyCount.textContent = `${history.length} track${history.length === 1 ? '' : 's'}`;
  elements.historyList.innerHTML = '';
  history.forEach((track) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const img = document.createElement('img');
    img.src = track.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    const title = document.createElement('span');
    title.textContent = `${track.title} — ${track.submittedBy}`;
    item.append(img, title, categoryChip(track));
    elements.historyList.appendChild(item);
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
      buckets: data.buckets || null,
      aiEnabled: !!data.aiEnabled,
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
    renderMixMeter();
    renderNowPlaying();
    renderQueue();
    renderHistory();
    renderAdminControls();
    setOverlay(!state.token);
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
    } else if (error.status === 404) {
      showToast('Party not found. It may have been removed.', 'error');
    } else {
      ensureRefreshTimer();
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
    showToast(error.message, 'error');
  }
}

async function setCategory(trackId, category) {
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}/category`, {
      method: 'POST',
      token: state.token,
      body: { category }
    });
    showToast(`Moved to the ${categoryLabel(category)} bucket.`, 'success');
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
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
    showToast('Track removed.', 'success');
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  }
}

async function promoteTrack(trackId) {
  try {
    await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos/${encodeURIComponent(trackId)}/promote`, {
      method: 'POST',
      token: state.token
    });
    showToast('Boosted — it will play next when its bucket comes up.', 'success');
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
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
    showToast(error.message, 'error');
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
    showToast(error.message, 'error');
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
    showToast(error.message, 'error');
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
    showToast(error.message, 'error');
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
  if (!state.token || state.user?.role !== 'admin') return;
  if (state.party?.endedAt) return;
  if (!confirm('End this party? Guests will no longer be able to join and the queue will be locked.')) return;
  elements.endParty.disabled = true;
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
    showToast(error.message, 'error');
    elements.endParty.disabled = false;
  }
}

elements.copyLink?.addEventListener('click', async () => {
  if (!state.party?.joinUrl) return;
  try {
    await navigator.clipboard.writeText(state.party.joinUrl);
    showToast('Invite link copied to clipboard.', 'success');
  } catch (error) {
    showToast('Could not copy the link automatically — copy it manually.', 'error');
  }
});

elements.videoForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.token) {
    setOverlay(true);
    return;
  }
  const formData = Object.fromEntries(new FormData(elements.videoForm));
  elements.composerButton.disabled = true;
  elements.composerButton.innerHTML = '<span class="spin"></span> Classifying…';
  try {
    const result = await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/videos`, {
      method: 'POST',
      token: state.token,
      body: formData
    });
    elements.videoForm.reset();
    const track = result.submission;
    showToast(`Added "${track.title}" to the ${categoryLabel(track.category)} bucket.`, 'success');
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    elements.composerButton.disabled = false;
    elements.composerButton.textContent = 'Add to queue';
  }
});

elements.endParty?.addEventListener('click', endCurrentParty);

elements.logout?.addEventListener('click', () => {
  if (session) {
    deleteSession(partyId);
  }
  window.location.href = '/';
});

elements.overlayForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.party?.endedAt) {
    showToast('This party has already ended.', 'error');
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
    showToast(`Welcome to the party, ${result.user.name}!`, 'success');
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    elements.overlayForm.querySelector('button').disabled = false;
  }
});

elements.overlayCancel?.addEventListener('click', () => {
  window.location.href = '/';
});

elements.adminPrevious?.addEventListener('click', goToPreviousTrack);
elements.adminNext?.addEventListener('click', goToNextTrack);
elements.adminRestart?.addEventListener('click', restartPlayerTrack);
elements.adminPlayPause?.addEventListener('click', togglePlayerPlayback);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.party?.endedAt) {
    refreshState().catch(console.error);
  }
});

refreshState();
