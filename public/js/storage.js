const STORAGE_KEY = 'vdojam.parties';

export function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load sessions', error);
    return {};
  }
}

export function saveSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('Failed to save sessions', error);
  }
}

export function updateSession(partyId, payload) {
  const sessions = loadSessions();
  sessions[partyId] = { ...sessions[partyId], ...payload };
  saveSessions(sessions);
  return sessions[partyId];
}

export function deleteSession(partyId) {
  const sessions = loadSessions();
  delete sessions[partyId];
  saveSessions(sessions);
}
