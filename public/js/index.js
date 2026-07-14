import { apiRequest } from './api.js';
import { loadSessions, updateSession } from './storage.js';
import { showToast } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  const createForm = document.getElementById('create-form');
  const createResult = document.getElementById('create-result');
  const joinForm = document.getElementById('join-form');
  const joinResult = document.getElementById('join-result');
  const recentCard = document.getElementById('recent-card');
  const recentList = document.getElementById('recent-list');

  function renderRecentParties() {
    const sessions = loadSessions();
    const entries = Object.entries(sessions);
    if (entries.length === 0) {
      recentCard.hidden = true;
      return;
    }
    recentCard.hidden = false;
    recentList.innerHTML = '';
    entries
      .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach(([partyId, session]) => {
        const item = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'recent-info';
        const name = document.createElement('strong');
        name.textContent = session.partyName || partyId;
        const id = document.createElement('span');
        id.textContent = partyId;
        info.append(name, document.createElement('br'), id);
        const button = document.createElement('button');
        button.className = 'secondary';
        button.textContent = 'Open';
        button.addEventListener('click', () => {
          window.location.href = `/party.html?partyId=${encodeURIComponent(partyId)}`;
        });
        item.append(info, button);
        recentList.appendChild(item);
      });
  }

  function showResult(element, message, success = true) {
    element.hidden = false;
    element.innerHTML = message;
    element.className = `callout ${success ? 'success' : 'error'}`;
  }

  function setBusy(form, busy) {
    const button = form.querySelector('button');
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.innerHTML = '<span class="spin"></span> Working…';
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(createForm));
    setBusy(createForm, true);
    try {
      const result = await apiRequest('/api/parties', { method: 'POST', body: data });
      updateSession(result.party.id, {
        authToken: result.authToken,
        userId: result.user.id,
        userName: result.user.name,
        role: result.user.role,
        partyName: result.party.name,
        updatedAt: Date.now()
      });
      window.location.href = `/party.html?partyId=${encodeURIComponent(result.party.id)}`;
      return;
    } catch (error) {
      console.error(error);
      showResult(createResult, error.message, false);
      showToast(error.message, 'error');
    } finally {
      setBusy(createForm, false);
    }
  });

  joinForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(joinForm));
    const partyId = (data.partyId || '').trim();
    setBusy(joinForm, true);
    try {
      const result = await apiRequest(`/api/parties/${encodeURIComponent(partyId)}/join`, {
        method: 'POST',
        body: { displayName: data.displayName }
      });
      updateSession(result.party.id, {
        authToken: result.authToken,
        userId: result.user.id,
        userName: result.user.name,
        role: result.user.role,
        partyName: result.party.name,
        updatedAt: Date.now()
      });
      window.location.href = `/party.html?partyId=${encodeURIComponent(result.party.id)}`;
      return;
    } catch (error) {
      console.error(error);
      showResult(joinResult, error.message, false);
      showToast(error.message, 'error');
    } finally {
      setBusy(joinForm, false);
    }
  });

  renderRecentParties();
});
