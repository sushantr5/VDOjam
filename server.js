import { createServer } from 'http';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const dataDir = join(__dirname, 'data');
const dbPath = join(dataDir, 'db.json');
const publicDir = join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

async function ensureDataDir() {
  try {
    await access(dataDir);
  } catch (error) {
    await mkdir(dataDir, { recursive: true });
  }
}

async function loadDb() {
  await ensureDataDir();
  try {
    const raw = await readFile(dbPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.parties) {
      parsed.parties = {};
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const initial = { parties: {} };
      await saveDb(initial);
      return initial;
    }
    throw error;
  }
}

async function saveDb(db) {
  await ensureDataDir();
  await writeFile(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generatePartyCode() {
  return crypto.randomBytes(3).toString('hex');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function methodNotAllowed(res) {
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}

function extractAuthToken(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return null;
}

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      if (parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts[0] === 'shorts' && pathParts[1]) {
        return pathParts[1];
      }
      if (pathParts[0] === 'embed' && pathParts[1]) {
        return pathParts[1];
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function fetchYoutubeDetails(videoId) {
  const url = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  return new Promise((resolve) => {
    const request = https.get(url, response => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume();
        resolve(null);
        return;
      }
      let body = '';
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            title: data.title,
            author: data.author_name,
            thumbnail: data.thumbnail_url
          });
        } catch (error) {
          resolve(null);
        }
      });
    });
    request.on('error', () => resolve(null));
    request.setTimeout(4000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

function summarizeSubmission(submission, viewerId) {
  const votes = submission.votes || {};
  const totals = Object.values(votes).reduce((acc, value) => {
    if (value === 1) acc.upvotes += 1;
    if (value === -1) acc.downvotes += 1;
    acc.score += value;
    return acc;
  }, { upvotes: 0, downvotes: 0, score: 0 });
  const viewerVote = viewerId ? votes[viewerId] || 0 : 0;
  return {
    id: submission.id,
    url: submission.url,
    videoId: submission.videoId,
    title: submission.title,
    channel: submission.channel,
    thumbnail: submission.thumbnail,
    submittedAt: submission.createdAt,
    submittedBy: submission.userName,
    submittedById: submission.userId,
    played: submission.played,
    priority: submission.priority || 0,
    ...totals,
    viewerVote
  };
}

function sortQueue(submissions) {
  return [...submissions].sort((a, b) => {
    if (!!a.played !== !!b.played) {
      return a.played ? 1 : -1;
    }
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    const scoreA = Object.values(a.votes || {}).reduce((acc, v) => acc + v, 0);
    const scoreB = Object.values(b.votes || {}).reduce((acc, v) => acc + v, 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function resolvePlaybackState(party) {
  const queue = sortQueue(party.submissions || []);
  let changed = false;
  let current = null;

  if (party.currentSubmissionId) {
    current = queue.find(item => item.id === party.currentSubmissionId);
    if (!current || current.played) {
      party.currentSubmissionId = null;
      current = null;
      changed = true;
    }
  }

  if (!current) {
    current = queue.find(item => !item.played);
    if (current && party.currentSubmissionId !== current.id) {
      party.currentSubmissionId = current.id;
      changed = true;
    }
  }

  const upcoming = queue.filter(item => !item.played && (!current || item.id !== current.id));
  const history = queue.filter(item => item.played);

  return { queue, current, upcoming, history, changed };
}

function isPartyEnded(party) {
  return !!party.endedAt;
}

function finalizeParty(party, endedAt = new Date().toISOString()) {
  party.endedAt = endedAt;
  party.currentSubmissionId = null;
  party.history = party.history || [];
  const knownHistory = new Set(party.history);
  for (const submission of party.submissions || []) {
    if (!submission.played) {
      submission.played = true;
      submission.playedAt = endedAt;
    }
    if (!knownHistory.has(submission.id)) {
      party.history.push(submission.id);
      knownHistory.add(submission.id);
    }
  }
}

async function authenticate(req, party) {
  const token = extractAuthToken(req);
  if (!token) return null;
  const tokens = party.tokens || {};
  const userId = tokens[token];
  if (!userId) return null;
  const user = party.users[userId];
  if (!user) return null;
  return user;
}

async function handleApi(req, res, url) {
  const db = await loadDb();
  const { pathname } = url;

  if (pathname === '/api/parties' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const partyName = (body.partyName || '').trim();
    const displayName = (body.displayName || '').trim();
    if (!partyName || !displayName) {
      sendJson(res, 400, { error: 'Party name and display name are required.' });
      return;
    }
    const partyId = generateId('pty');
    const accessCode = generatePartyCode();
    const userId = generateId('usr');
    const authToken = generateId('tok');
    const createdAt = new Date().toISOString();

    db.parties[partyId] = {
      id: partyId,
      name: partyName,
      accessCode,
      createdAt,
      endedAt: null,
      users: {
        [userId]: {
          id: userId,
          name: displayName,
          role: 'admin',
          joinedAt: createdAt
        }
      },
      tokens: {
        [authToken]: userId
      },
      submissions: [],
      history: []
    };

    await saveDb(db);

    const origin = getBaseUrl(req);
    const joinUrl = `${origin}/party.html?partyId=${partyId}`;

    sendJson(res, 201, {
      party: {
        id: partyId,
        name: partyName,
        joinUrl,
        accessCode
      },
      user: {
        id: userId,
        name: displayName,
        role: 'admin'
      },
      authToken
    });
    return;
  }

  const partyMatch = pathname.match(/^\/api\/parties\/([^/]+)(.*)$/);
  if (!partyMatch) {
    notFound(res);
    return;
  }
  const partyId = partyMatch[1];
  const restPath = partyMatch[2] || '';
  const party = db.parties[partyId];
  if (!party) {
    sendJson(res, 404, { error: 'Party not found.' });
    return;
  }

  const viewer = await authenticate(req, party);

  if (restPath === '' || restPath === '/') {
    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    const playback = resolvePlaybackState(party);
    if (playback.changed) {
      await saveDb(db);
    }
    const viewerId = viewer ? viewer.id : null;
    const submissions = playback.upcoming.map(item => summarizeSubmission(item, viewerId));
    const remainingUploads = viewerId
      ? Math.max(0, 3 - playback.queue.filter(item => !item.played && item.userId === viewerId).length)
      : null;
    const response = {
      party: {
        id: party.id,
        name: party.name,
        createdAt: party.createdAt,
        joinUrl: `${getBaseUrl(req)}/party.html?partyId=${party.id}`,
        endedAt: party.endedAt || null
      },
      submissions,
      nowPlaying: playback.current ? summarizeSubmission(playback.current, viewerId) : null,
      history: playback.history.map(item => summarizeSubmission(item, viewerId))
    };
    if (viewer) {
      response.user = { id: viewer.id, name: viewer.name, role: viewer.role };
      response.remainingUploads = remainingUploads;
      if (viewer.role === 'admin') {
        response.party.accessCode = party.accessCode;
      }
    }
    sendJson(res, 200, response);
    return;
  }

  if (restPath === '/join' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    if (isPartyEnded(party)) {
      sendJson(res, 410, { error: 'This party has already ended.' });
      return;
    }
    const displayName = (body.displayName || '').trim();
    if (!displayName) {
      sendJson(res, 400, { error: 'Display name is required.' });
      return;
    }
    const userId = generateId('usr');
    const authToken = generateId('tok');
    const joinedAt = new Date().toISOString();

    party.users = party.users || {};
    party.tokens = party.tokens || {};

    party.users[userId] = {
      id: userId,
      name: displayName,
      role: 'guest',
      joinedAt
    };
    party.tokens[authToken] = userId;
    await saveDb(db);
    sendJson(res, 201, {
      party: {
        id: party.id,
        name: party.name
      },
      user: {
        id: userId,
        name: displayName,
        role: 'guest'
      },
      authToken
    });
    return;
  }

  if (restPath === '/login' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const authToken = body.authToken;
    if (!authToken) {
      sendJson(res, 400, { error: 'authToken is required.' });
      return;
    }
    const userId = party.tokens?.[authToken];
    if (!userId) {
      sendJson(res, 404, { error: 'Session not found.' });
      return;
    }
    const user = party.users[userId];
    sendJson(res, 200, { user });
    return;
  }

  if (restPath === '/videos' && req.method === 'POST') {
    if (!viewer) {
      sendJson(res, 401, { error: 'Authentication required.' });
      return;
    }
    if (isPartyEnded(party)) {
      sendJson(res, 409, { error: 'This party has already ended.' });
      return;
    }
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const urlStr = (body.url || '').trim();
    if (!urlStr) {
      sendJson(res, 400, { error: 'YouTube link is required.' });
      return;
    }
    const videoId = extractYouTubeId(urlStr);
    if (!videoId) {
      sendJson(res, 400, { error: 'Unable to read that YouTube link. Try a different format.' });
      return;
    }
    const activeCount = (party.submissions || []).filter(item => !item.played && item.userId === viewer.id).length;
    if (activeCount >= 3) {
      sendJson(res, 400, { error: 'You have reached the limit of 3 active tracks.' });
      return;
    }
    const metadata = await fetchYoutubeDetails(videoId);
    const createdAt = new Date().toISOString();
    const submission = {
      id: generateId('vid'),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      title: metadata?.title || `YouTube video (${videoId})`,
      channel: metadata?.author || 'Unknown creator',
      thumbnail: metadata?.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      createdAt,
      userId: viewer.id,
      userName: viewer.name,
      votes: {},
      played: false,
      priority: 0
    };
    party.submissions = party.submissions || [];
    party.submissions.push(submission);
    await saveDb(db);
    sendJson(res, 201, { submission: summarizeSubmission(submission, viewer.id) });
    return;
  }

  const videoMatch = restPath.match(/^\/videos\/([^/]+)(.*)$/);
  if (videoMatch) {
    const submissionId = videoMatch[1];
    const videoAction = videoMatch[2] || '';
    const submission = (party.submissions || []).find(item => item.id === submissionId);
    if (!submission) {
      sendJson(res, 404, { error: 'Track not found.' });
      return;
    }

    if (isPartyEnded(party)) {
      sendJson(res, 409, { error: 'This party has already ended.' });
      return;
    }

    if (videoAction === '' || videoAction === '/') {
      if (req.method === 'DELETE') {
        if (!viewer || (viewer.role !== 'admin' && viewer.id !== submission.userId)) {
          sendJson(res, 403, { error: 'You do not have permission to remove this track.' });
          return;
        }
        party.submissions = party.submissions.filter(item => item.id !== submissionId);
        if (party.currentSubmissionId === submissionId) {
          party.currentSubmissionId = null;
        }
        if (Array.isArray(party.history)) {
          party.history = party.history.filter(id => id !== submissionId);
        }
        await saveDb(db);
        sendJson(res, 200, { success: true });
        return;
      }
      methodNotAllowed(res);
      return;
    }

    if (videoAction === '/vote' && req.method === 'POST') {
      if (!viewer) {
        sendJson(res, 401, { error: 'Authentication required.' });
        return;
      }
      let body;
      try {
        body = await parseBody(req);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      const value = Number(body.value);
      if (![ -1, 0, 1 ].includes(value)) {
        sendJson(res, 400, { error: 'Vote value must be -1, 0, or 1.' });
        return;
      }
      if (party.currentSubmissionId === submission.id && !submission.played) {
        sendJson(res, 409, { error: 'The track currently playing cannot be voted on.' });
        return;
      }
      submission.votes = submission.votes || {};
      if (value === 0) {
        delete submission.votes[viewer.id];
      } else {
        submission.votes[viewer.id] = value;
      }
      await saveDb(db);
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/promote' && req.method === 'POST') {
      if (!viewer || viewer.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin privileges required.' });
        return;
      }
      submission.priority = Date.now();
      await saveDb(db);
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/mark-played' && req.method === 'POST') {
      if (!viewer || viewer.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin privileges required.' });
        return;
      }
      submission.played = true;
      submission.playedAt = new Date().toISOString();
      if (party.currentSubmissionId === submission.id) {
        party.currentSubmissionId = null;
      }
      party.history = party.history || [];
      if (!party.history.includes(submission.id)) {
        party.history.push(submission.id);
      }
      await saveDb(db);
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/reset-priority' && req.method === 'POST') {
      if (!viewer || viewer.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin privileges required.' });
        return;
      }
      submission.priority = 0;
      await saveDb(db);
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }
  }

  if (restPath === '/end' && req.method === 'POST') {
    if (!viewer || viewer.role !== 'admin') {
      sendJson(res, 403, { error: 'Admin privileges required.' });
      return;
    }
    if (!isPartyEnded(party)) {
      finalizeParty(party);
      await saveDb(db);
    }
    sendJson(res, 200, {
      party: { id: party.id, name: party.name, endedAt: party.endedAt }
    });
    return;
  }

  if (restPath === '/player/state' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const accessCode = (body.accessCode || '').trim();
    if (accessCode !== party.accessCode) {
      sendJson(res, 403, { error: 'Invalid access code.' });
      return;
    }
    const playback = resolvePlaybackState(party);
    if (playback.changed) {
      await saveDb(db);
    }
    const response = {
      party: { id: party.id, name: party.name, endedAt: party.endedAt || null },
      nowPlaying: playback.current ? summarizeSubmission(playback.current) : null,
      upcoming: playback.upcoming.map(item => summarizeSubmission(item)),
      history: playback.history.map(item => summarizeSubmission(item)),
      canGoPrevious: !isPartyEnded(party) && (party.history || []).length > 0
    };
    if (isPartyEnded(party)) {
      response.nowPlaying = null;
      response.upcoming = [];
    }
    sendJson(res, 200, response);
    return;
  }

  if (restPath === '/player/advance' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const accessCode = (body.accessCode || '').trim();
    const submissionId = body.submissionId;
    if (accessCode !== party.accessCode) {
      sendJson(res, 403, { error: 'Invalid access code.' });
      return;
    }
    if (isPartyEnded(party)) {
      sendJson(res, 409, { error: 'This party has already ended.' });
      return;
    }
    const submission = (party.submissions || []).find(item => item.id === submissionId);
    if (!submission) {
      sendJson(res, 404, { error: 'Track not found.' });
      return;
    }
    if (party.currentSubmissionId && party.currentSubmissionId !== submission.id) {
      sendJson(res, 409, { error: 'This track is not currently playing.' });
      return;
    }
    submission.played = true;
    submission.playedAt = new Date().toISOString();
    if (party.currentSubmissionId === submission.id) {
      party.currentSubmissionId = null;
    }
    party.history = party.history || [];
    if (!party.history.includes(submission.id)) {
      party.history.push(submission.id);
    }
    await saveDb(db);
    sendJson(res, 200, { success: true });
    return;
  }

  if (restPath === '/player/previous' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    const accessCode = (body.accessCode || '').trim();
    if (accessCode !== party.accessCode) {
      sendJson(res, 403, { error: 'Invalid access code.' });
      return;
    }
    if (isPartyEnded(party)) {
      sendJson(res, 409, { error: 'This party has already ended.' });
      return;
    }
    party.history = party.history || [];
    const previousId = party.history.pop();
    if (!previousId) {
      sendJson(res, 404, { error: 'No previous track to play.' });
      return;
    }
    const submission = (party.submissions || []).find(item => item.id === previousId);
    if (!submission) {
      sendJson(res, 404, { error: 'Track not found.' });
      return;
    }
    submission.played = false;
    submission.playedAt = null;
    submission.priority = Date.now();
    party.currentSubmissionId = submission.id;
    await saveDb(db);
    sendJson(res, 200, { submission: summarizeSubmission(submission) });
    return;
  }

  if (restPath === '/player/reset' && req.method === 'POST') {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    if ((body.accessCode || '').trim() !== party.accessCode) {
      sendJson(res, 403, { error: 'Invalid access code.' });
      return;
    }
    if (isPartyEnded(party)) {
      sendJson(res, 409, { error: 'This party has already ended.' });
      return;
    }
    for (const submission of party.submissions || []) {
      submission.played = false;
      submission.priority = 0;
    }
    party.currentSubmissionId = null;
    party.history = [];
    await saveDb(db);
    sendJson(res, 200, { success: true });
    return;
  }

  notFound(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    let filePath = join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!filePath.startsWith(publicDir)) {
      notFound(res);
      return;
    }

    const ext = extname(filePath) || '.html';
    const type = mimeTypes[ext] || 'application/octet-stream';
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      notFound(res);
    });
    stream.on('open', () => {
      res.writeHead(200, { 'Content-Type': type });
      stream.pipe(res);
    });
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`VDOjam server running at http://${HOST}:${PORT}`);
});
