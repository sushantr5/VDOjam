/**
 * Detached video screen. Holds only the YouTube player; all queue logic and
 * controls live in the player page (player.js), which talks to this window
 * over a BroadcastChannel. Works across windows of the same browser profile,
 * so the controller tab and this screen can sit on different displays.
 */

const params = new URLSearchParams(window.location.search);
const partyId = params.get('partyId');

const elements = {
  status: document.getElementById('screen-status'),
  statusText: document.getElementById('status-text'),
  activate: document.getElementById('screen-activate'),
  activateButton: document.getElementById('activate-button'),
  hint: document.getElementById('screen-hint')
};

let player = null;
let playerReady = false;
let activated = false;
let current = null;
let pendingLoad = null;

const channel = partyId ? new BroadcastChannel(`vdojam-screen-${partyId}`) : null;

if (!partyId) {
  elements.statusText.textContent = 'Missing party ID. Open this screen from the player page.';
}

function post(message) {
  if (channel) {
    channel.postMessage(message);
  }
}

function setStatus(text) {
  elements.statusText.textContent = text;
}

function showVideoSurface(visible) {
  elements.status.hidden = visible;
}

function currentTime() {
  try {
    return player && playerReady ? Math.max(0, player.getCurrentTime() || 0) : 0;
  } catch (error) {
    return 0;
  }
}

function loadVideo(data) {
  current = data;
  document.title = `${data.title || 'Video'} — VDOjam screen`;
  if (!playerReady) {
    pendingLoad = data;
    return;
  }
  showVideoSurface(true);
  player.loadVideoById({ videoId: data.videoId, startSeconds: data.start || 0 });
  if (!activated) {
    elements.activate.hidden = false;
  }
}

function stopVideo(message) {
  current = null;
  document.title = 'Video screen — VDOjam';
  if (player && playerReady) {
    player.stopVideo();
  }
  showVideoSurface(false);
  setStatus(message || 'Waiting for the next track…');
}

if (channel) {
  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'load':
        loadVideo(data);
        break;
      case 'play':
        if (player && playerReady) player.playVideo();
        break;
      case 'pause':
        if (player && playerReady) player.pauseVideo();
        break;
      case 'restart':
        if (player && playerReady) {
          player.seekTo(0, true);
          player.playVideo();
        }
        break;
      case 'stop':
        stopVideo(data.message);
        break;
      case 'close':
        post({ type: 'bye', currentTime: currentTime() });
        window.close();
        break;
      default:
        break;
    }
  };
}

elements.activateButton.addEventListener('click', () => {
  activated = true;
  elements.activate.hidden = true;
  if (player && playerReady && current) {
    player.playVideo();
  }
});

document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

setTimeout(() => elements.hint.classList.add('faded'), 8000);

// Report playback position so the controller can resume seamlessly if the
// video is brought back to the main window.
setInterval(() => {
  if (current && playerReady) {
    post({ type: 'time', currentTime: currentTime() });
  }
}, 5000);

window.addEventListener('pagehide', () => {
  post({ type: 'bye', currentTime: currentTime() });
});

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    playerVars: { rel: 0 },
    events: {
      onReady: () => {
        playerReady = true;
        post({ type: 'hello' });
        if (pendingLoad) {
          const data = pendingLoad;
          pendingLoad = null;
          loadVideo(data);
        }
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          post({ type: 'ended', id: current ? current.id : null });
        }
        if (event.data === YT.PlayerState.PLAYING) {
          activated = true;
          elements.activate.hidden = true;
          showVideoSurface(true);
          post({ type: 'state', paused: false, currentTime: currentTime() });
        }
        if (event.data === YT.PlayerState.PAUSED) {
          post({ type: 'state', paused: true, currentTime: currentTime() });
        }
      },
      onError: () => {
        post({ type: 'error', id: current ? current.id : null });
      }
    }
  });
}

window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
