import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname, join, normalize, resolve as resolvePath } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { initDb, getDb, persist, generateId, generateAccessCode } from './lib/db.js';
import {
  parseBody, sendJson, sendError, notFound, methodNotAllowed,
  extractAuthToken, cleanText, HttpError
} from './lib/http.js';
import { extractYouTubeId, fetchYoutubeDetails } from './lib/youtube.js';
import { classifySong, isLlmConfigured, CATEGORIES, CATEGORY_INDIAN, CATEGORY_WESTERN } from './lib/classifier.js';
import {
  resolvePlaybackState, splitBuckets, ensureCategory,
  categoryOf, otherCategory, markPlayed
} from './lib/queue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const publicDir = join(__dirname, 'public');

const MAX_ACTIVE_TRACKS_PER_USER = 3;
const NAME_MAX_LENGTH = 60;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function summarizeSubmission(submission, viewerId) {
  ensureCategory(submission);
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
    playedAt: submission.playedAt || null,
    priority: submission.priority || 0,
    category: categoryOf(submission),
    categorySource: submission.categorySource || 'heuristic',
    categoryReason: submission.categoryReason || null,
    ...totals,
    viewerVote
  };
}

function summarizeBuckets(party) {
  const unplayed = (party.submissions || []).filter(item => !item.played).map(ensureCategory);
  const buckets = splitBuckets(unplayed);
  return {
    [CATEGORY_INDIAN]: buckets[CATEGORY_INDIAN].length,
    [CATEGORY_WESTERN]: buckets[CATEGORY_WESTERN].length,
    lastPlayedCategory: party.lastPlayedCategory || null,
    nextCategory: party.lastPlayedCategory ? otherCategory(party.lastPlayedCategory) : null
  };
}

function isPartyEnded(party) {
  return !!party.endedAt;
}

function ensurePlayerState(party) {
  if (!party.playerState) {
    party.playerState = { isPaused: false, updatedAt: null };
  }
  if (!Array.isArray(party.playerCommands)) {
    party.playerCommands = [];
  }
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

function authenticate(req, party) {
  const token = extractAuthToken(req);
  if (!token) return null;
  const userId = (party.tokens || {})[token];
  if (!userId) return null;
  return party.users?.[userId] || null;
}

function requireAdmin(res, viewer) {
  if (!viewer || viewer.role !== 'admin') {
    sendError(res, 403, 'Admin privileges required.');
    return false;
  }
  return true;
}

function requireActiveParty(res, party) {
  if (isPartyEnded(party)) {
    sendError(res, 409, 'This party has already ended.');
    return false;
  }
  return true;
}

function verifyAccessCode(res, party, body) {
  const accessCode = cleanText(body.accessCode, 32);
  if (!accessCode || accessCode !== party.accessCode) {
    sendError(res, 403, 'Invalid access code.');
    return false;
  }
  return true;
}

async function handleApi(req, res, url) {
  const db = getDb();
  const { pathname } = url;

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      status: 'ok',
      aiClassifier: isLlmConfigured() ? 'llm' : 'heuristic',
      uptime: Math.round(process.uptime())
    });
    return;
  }

  if (pathname === '/api/parties' && req.method === 'POST') {
    const body = await parseBody(req);
    const partyName = cleanText(body.partyName, NAME_MAX_LENGTH);
    const displayName = cleanText(body.displayName, NAME_MAX_LENGTH);
    if (!partyName || !displayName) {
      sendError(res, 400, 'Party name and display name are required.');
      return;
    }
    const partyId = generateId('pty');
    const accessCode = generateAccessCode();
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
        [userId]: { id: userId, name: displayName, role: 'admin', joinedAt: createdAt }
      },
      tokens: { [authToken]: userId },
      submissions: [],
      history: [],
      lastPlayedCategory: null,
      playerState: { isPaused: false, updatedAt: createdAt },
      playerCommands: []
    };

    await persist();

    sendJson(res, 201, {
      party: {
        id: partyId,
        name: partyName,
        joinUrl: `${getBaseUrl(req)}/party.html?partyId=${partyId}`,
        accessCode
      },
      user: { id: userId, name: displayName, role: 'admin' },
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
    sendError(res, 404, 'Party not found.');
    return;
  }

  const viewer = authenticate(req, party);

  if (restPath === '' || restPath === '/') {
    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    ensurePlayerState(party);
    const playback = resolvePlaybackState(party);
    if (playback.changed) {
      await persist();
    }
    const viewerId = viewer ? viewer.id : null;
    const response = {
      party: {
        id: party.id,
        name: party.name,
        createdAt: party.createdAt,
        joinUrl: `${getBaseUrl(req)}/party.html?partyId=${party.id}`,
        endedAt: party.endedAt || null
      },
      aiEnabled: isLlmConfigured(),
      buckets: summarizeBuckets(party),
      submissions: playback.upcoming.map(item => summarizeSubmission(item, viewerId)),
      nowPlaying: playback.current ? summarizeSubmission(playback.current, viewerId) : null,
      history: playback.history.map(item => summarizeSubmission(item, viewerId))
    };
    if (viewer) {
      response.user = { id: viewer.id, name: viewer.name, role: viewer.role };
      const activeCount = (party.submissions || []).filter(item => !item.played && item.userId === viewer.id).length;
      response.remainingUploads = Math.max(0, MAX_ACTIVE_TRACKS_PER_USER - activeCount);
      if (viewer.role === 'admin') {
        response.party.accessCode = party.accessCode;
        response.playerState = {
          isPaused: !!party.playerState?.isPaused,
          updatedAt: party.playerState?.updatedAt || null
        };
      }
    }
    sendJson(res, 200, response);
    return;
  }

  if (restPath === '/join' && req.method === 'POST') {
    const body = await parseBody(req);
    if (isPartyEnded(party)) {
      sendError(res, 410, 'This party has already ended.');
      return;
    }
    const displayName = cleanText(body.displayName, NAME_MAX_LENGTH);
    if (!displayName) {
      sendError(res, 400, 'Display name is required.');
      return;
    }
    const userId = generateId('usr');
    const authToken = generateId('tok');
    const joinedAt = new Date().toISOString();

    party.users = party.users || {};
    party.tokens = party.tokens || {};
    party.users[userId] = { id: userId, name: displayName, role: 'guest', joinedAt };
    party.tokens[authToken] = userId;
    await persist();
    sendJson(res, 201, {
      party: { id: party.id, name: party.name },
      user: { id: userId, name: displayName, role: 'guest' },
      authToken
    });
    return;
  }

  if (restPath === '/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const authToken = body.authToken;
    if (!authToken) {
      sendError(res, 400, 'authToken is required.');
      return;
    }
    const userId = party.tokens?.[authToken];
    if (!userId) {
      sendError(res, 404, 'Session not found.');
      return;
    }
    sendJson(res, 200, { user: party.users[userId] });
    return;
  }

  if (restPath === '/videos' && req.method === 'POST') {
    if (!viewer) {
      sendError(res, 401, 'Authentication required.');
      return;
    }
    if (!requireActiveParty(res, party)) return;
    const body = await parseBody(req);
    const urlStr = cleanText(body.url, 500);
    if (!urlStr) {
      sendError(res, 400, 'YouTube link is required.');
      return;
    }
    const videoId = extractYouTubeId(urlStr);
    if (!videoId) {
      sendError(res, 400, 'That does not look like a valid YouTube link. Try copying it again.');
      return;
    }
    party.submissions = party.submissions || [];
    const duplicate = party.submissions.find(item => !item.played && item.videoId === videoId);
    if (duplicate) {
      sendError(res, 409, `"${duplicate.title}" is already in the queue.`);
      return;
    }
    const activeCount = party.submissions.filter(item => !item.played && item.userId === viewer.id).length;
    if (activeCount >= MAX_ACTIVE_TRACKS_PER_USER) {
      sendError(res, 400, `You have reached the limit of ${MAX_ACTIVE_TRACKS_PER_USER} active tracks.`);
      return;
    }

    const metadata = await fetchYoutubeDetails(videoId);
    const title = metadata?.title || `YouTube video (${videoId})`;
    const channel = metadata?.author || 'Unknown creator';
    const classification = await classifySong({ title, channel });

    const submission = {
      id: generateId('vid'),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      title,
      channel,
      thumbnail: metadata?.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      createdAt: new Date().toISOString(),
      userId: viewer.id,
      userName: viewer.name,
      votes: {},
      played: false,
      priority: 0,
      category: classification.category,
      categorySource: classification.source,
      categoryReason: classification.reason || null
    };
    party.submissions.push(submission);
    await persist();
    sendJson(res, 201, { submission: summarizeSubmission(submission, viewer.id) });
    return;
  }

  const videoMatch = restPath.match(/^\/videos\/([^/]+)(.*)$/);
  if (videoMatch) {
    const submissionId = videoMatch[1];
    const videoAction = videoMatch[2] || '';
    const submission = (party.submissions || []).find(item => item.id === submissionId);
    if (!submission) {
      sendError(res, 404, 'Track not found.');
      return;
    }
    if (!requireActiveParty(res, party)) return;

    if (videoAction === '' || videoAction === '/') {
      if (req.method === 'DELETE') {
        if (!viewer || (viewer.role !== 'admin' && viewer.id !== submission.userId)) {
          sendError(res, 403, 'You do not have permission to remove this track.');
          return;
        }
        party.submissions = party.submissions.filter(item => item.id !== submissionId);
        if (party.currentSubmissionId === submissionId) {
          party.currentSubmissionId = null;
        }
        if (Array.isArray(party.history)) {
          party.history = party.history.filter(id => id !== submissionId);
        }
        await persist();
        sendJson(res, 200, { success: true });
        return;
      }
      methodNotAllowed(res);
      return;
    }

    if (videoAction === '/vote' && req.method === 'POST') {
      if (!viewer) {
        sendError(res, 401, 'Authentication required.');
        return;
      }
      const body = await parseBody(req);
      const value = Number(body.value);
      if (![-1, 0, 1].includes(value)) {
        sendError(res, 400, 'Vote value must be -1, 0, or 1.');
        return;
      }
      if (party.currentSubmissionId === submission.id && !submission.played) {
        sendError(res, 409, 'The track currently playing cannot be voted on.');
        return;
      }
      submission.votes = submission.votes || {};
      if (value === 0) {
        delete submission.votes[viewer.id];
      } else {
        submission.votes[viewer.id] = value;
      }
      await persist();
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/category' && req.method === 'POST') {
      if (!requireAdmin(res, viewer)) return;
      const body = await parseBody(req);
      const category = cleanText(body.category, 20).toLowerCase();
      if (!CATEGORIES.includes(category)) {
        sendError(res, 400, `Category must be one of: ${CATEGORIES.join(', ')}.`);
        return;
      }
      submission.category = category;
      submission.categorySource = 'manual';
      submission.categoryReason = `Set by ${viewer.name}`;
      await persist();
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/promote' && req.method === 'POST') {
      if (!requireAdmin(res, viewer)) return;
      submission.priority = Date.now();
      await persist();
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/mark-played' && req.method === 'POST') {
      if (!requireAdmin(res, viewer)) return;
      markPlayed(party, submission);
      await persist();
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    if (videoAction === '/reset-priority' && req.method === 'POST') {
      if (!requireAdmin(res, viewer)) return;
      submission.priority = 0;
      await persist();
      sendJson(res, 200, { submission: summarizeSubmission(submission, viewer.id) });
      return;
    }

    notFound(res);
    return;
  }

  if (restPath === '/end' && req.method === 'POST') {
    if (!requireAdmin(res, viewer)) return;
    if (!isPartyEnded(party)) {
      finalizeParty(party);
      await persist();
    }
    sendJson(res, 200, {
      party: { id: party.id, name: party.name, endedAt: party.endedAt }
    });
    return;
  }

  if (restPath === '/player/control' && req.method === 'POST') {
    const body = await parseBody(req);
    const action = cleanText(body.action, 20).toLowerCase();
    const allowedActions = new Set(['restart', 'pause', 'play']);
    const accessCode = cleanText(body.accessCode, 32);
    const authorized = (viewer && viewer.role === 'admin') || (accessCode && accessCode === party.accessCode);
    if (!authorized) {
      sendError(res, 403, 'Admin privileges required.');
      return;
    }
    if (!allowedActions.has(action)) {
      sendError(res, 400, 'Unsupported player action.');
      return;
    }
    if (!requireActiveParty(res, party)) return;
    ensurePlayerState(party);
    const command = { id: generateId('cmd'), action, createdAt: new Date().toISOString() };
    party.playerCommands.push(command);
    if (party.playerCommands.length > 20) {
      party.playerCommands = party.playerCommands.slice(-20);
    }
    await persist();
    sendJson(res, 200, { command });
    return;
  }

  if (restPath === '/player/state' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!verifyAccessCode(res, party, body)) return;
    ensurePlayerState(party);
    const playback = resolvePlaybackState(party);
    let shouldSave = playback.changed;
    const acks = Array.isArray(body.acks) ? body.acks.filter(id => typeof id === 'string') : [];
    if (acks.length) {
      const ackSet = new Set(acks);
      const before = party.playerCommands.length;
      party.playerCommands = party.playerCommands.filter(cmd => !ackSet.has(cmd.id));
      if (party.playerCommands.length !== before) {
        shouldSave = true;
      }
    }
    if (body.playerState && typeof body.playerState.isPaused === 'boolean') {
      const nextValue = !!body.playerState.isPaused;
      if (!!party.playerState.isPaused !== nextValue) {
        shouldSave = true;
      }
      party.playerState = {
        ...party.playerState,
        isPaused: nextValue,
        updatedAt: new Date().toISOString()
      };
    }
    if (isPartyEnded(party) && party.playerCommands.length) {
      party.playerCommands = [];
      shouldSave = true;
    }
    if (shouldSave) {
      await persist();
    }
    const response = {
      party: { id: party.id, name: party.name, endedAt: party.endedAt || null },
      buckets: summarizeBuckets(party),
      nowPlaying: playback.current ? summarizeSubmission(playback.current) : null,
      upcoming: playback.upcoming.map(item => summarizeSubmission(item)),
      history: playback.history.map(item => summarizeSubmission(item)),
      canGoPrevious: !isPartyEnded(party) && (party.history || []).length > 0,
      playerState: {
        isPaused: !!party.playerState.isPaused,
        updatedAt: party.playerState.updatedAt
      },
      commands: party.playerCommands.map(cmd => ({ id: cmd.id, action: cmd.action, createdAt: cmd.createdAt }))
    };
    if (isPartyEnded(party)) {
      response.nowPlaying = null;
      response.upcoming = [];
      response.commands = [];
    }
    sendJson(res, 200, response);
    return;
  }

  if (restPath === '/player/advance' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!verifyAccessCode(res, party, body)) return;
    if (!requireActiveParty(res, party)) return;
    const submission = (party.submissions || []).find(item => item.id === body.submissionId);
    if (!submission) {
      sendError(res, 404, 'Track not found.');
      return;
    }
    if (party.currentSubmissionId && party.currentSubmissionId !== submission.id) {
      sendError(res, 409, 'This track is not currently playing.');
      return;
    }
    markPlayed(party, submission);
    await persist();
    sendJson(res, 200, { success: true });
    return;
  }

  if (restPath === '/player/previous' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!verifyAccessCode(res, party, body)) return;
    if (!requireActiveParty(res, party)) return;
    party.history = party.history || [];
    const previousId = party.history.pop();
    if (!previousId) {
      sendError(res, 404, 'No previous track to play.');
      return;
    }
    const submission = (party.submissions || []).find(item => item.id === previousId);
    if (!submission) {
      sendError(res, 404, 'Track not found.');
      return;
    }
    submission.played = false;
    submission.playedAt = null;
    submission.priority = Date.now();
    party.currentSubmissionId = submission.id;
    // Rewind the alternation pointer to the track played before this one.
    const priorId = party.history[party.history.length - 1];
    const prior = priorId ? (party.submissions || []).find(item => item.id === priorId) : null;
    party.lastPlayedCategory = prior ? categoryOf(ensureCategory(prior)) : null;
    await persist();
    sendJson(res, 200, { submission: summarizeSubmission(submission) });
    return;
  }

  if (restPath === '/player/reset' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!verifyAccessCode(res, party, body)) return;
    if (!requireActiveParty(res, party)) return;
    for (const submission of party.submissions || []) {
      submission.played = false;
      submission.playedAt = null;
      submission.priority = 0;
    }
    party.currentSubmissionId = null;
    party.history = [];
    party.lastPlayedCategory = null;
    await persist();
    sendJson(res, 200, { success: true });
    return;
  }

  notFound(res);
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res);
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = resolvePath(join(publicDir, normalize(requested)));
  if (!filePath.startsWith(publicDir)) {
    notFound(res);
    return;
  }
  let stats;
  try {
    stats = await stat(filePath);
    if (!stats.isFile()) {
      notFound(res);
      return;
    }
  } catch (error) {
    notFound(res);
    return;
  }
  const ext = extname(filePath) || '.html';
  const type = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stats.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendError(res, error.status, error.message);
      return;
    }
    console.error('Unhandled request error:', error);
    sendError(res, 500, 'Internal server error.');
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await initDb();
server.listen(PORT, HOST, () => {
  console.log(`VDOjam server running at http://${HOST}:${PORT}`);
  console.log(`AI song classification: ${isLlmConfigured() ? `LLM (${process.env.LLM_MODEL || 'gpt-4o-mini'})` : 'heuristic fallback (set LLM_API_KEY to enable the LLM)'}`);
});
