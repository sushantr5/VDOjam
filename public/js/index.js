import { apiRequest } from './api.js';
import { loadSessions, updateSession } from './storage.js';

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
        info.innerHTML = `<strong>${session.partyName || partyId}</strong><br /><span>${partyId}</span>`;
        const button = document.createElement('button');
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

  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(createForm));
    createForm.querySelector('button').disabled = true;
    try {
      const result = await apiRequest('/api/parties', {
        method: 'POST',
        body: data
      });
      updateSession(result.party.id, {
        authToken: result.authToken,
        userId: result.user.id,
        userName: result.user.name,
        role: result.user.role,
        partyName: result.party.name,
        updatedAt: Date.now()
      });
      const qrLink = `${result.party.joinUrl}`;
      const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrLink)}`;
      showResult(
        createResult,
        `Party created! Share <a href="${qrLink}">${qrLink}</a> or show this QR code:<br><img src="${qrImage}" alt="QR code to join" loading="lazy" /><br>Access code for the player: <strong>${result.party.accessCode}</strong>`
      );
      renderRecentParties();
    } catch (error) {
      console.error(error);
      showResult(createResult, error.message, false);
    } finally {
      createForm.querySelector('button').disabled = false;
    }
  });

  joinForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(joinForm));
    joinForm.querySelector('button').disabled = true;
    try {
      const result = await apiRequest(`/api/parties/${encodeURIComponent(data.partyId)}/join`, {
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
      showResult(
        joinResult,
        `You are in! Continue to the party room: <a href="/party.html?partyId=${encodeURIComponent(result.party.id)}">Open party</a>`
      );
      renderRecentParties();
    } catch (error) {
      console.error(error);
      showResult(joinResult, error.message, false);
    } finally {
      joinForm.querySelector('button').disabled = false;
    }
  });

  renderRecentParties();
});
