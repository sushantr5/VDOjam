import { CATEGORY_INDIAN, CATEGORY_WESTERN, classifyHeuristically } from './classifier.js';

export function otherCategory(category) {
  return category === CATEGORY_INDIAN ? CATEGORY_WESTERN : CATEGORY_INDIAN;
}

export function categoryOf(submission) {
  return submission.category === CATEGORY_INDIAN ? CATEGORY_INDIAN : CATEGORY_WESTERN;
}

/** Backfill classification for submissions created before buckets existed. */
export function ensureCategory(submission) {
  if (submission.category === CATEGORY_INDIAN || submission.category === CATEGORY_WESTERN) {
    return submission;
  }
  const result = classifyHeuristically({ title: submission.title, channel: submission.channel });
  submission.category = result.category;
  submission.categorySource = result.source;
  submission.categoryReason = result.reason;
  return submission;
}

export function voteScore(submission) {
  return Object.values(submission.votes || {}).reduce((acc, value) => acc + value, 0);
}

function compareRank(a, b) {
  const priorityDiff = (b.priority || 0) - (a.priority || 0);
  if (priorityDiff !== 0) return priorityDiff;
  const scoreDiff = voteScore(b) - voteScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/** Rank the songs of a single bucket: priority, then votes, then FIFO. */
export function sortBucket(submissions) {
  return [...submissions].sort(compareRank);
}

function pickStartingCategory(buckets) {
  const topIndian = buckets[CATEGORY_INDIAN][0];
  const topWestern = buckets[CATEGORY_WESTERN][0];
  if (!topIndian) return CATEGORY_WESTERN;
  if (!topWestern) return CATEGORY_INDIAN;
  return compareRank(topIndian, topWestern) <= 0 ? categoryOf(topIndian) : categoryOf(topWestern);
}

export function splitBuckets(submissions) {
  const buckets = { [CATEGORY_INDIAN]: [], [CATEGORY_WESTERN]: [] };
  for (const submission of submissions) {
    buckets[categoryOf(submission)].push(submission);
  }
  buckets[CATEGORY_INDIAN] = sortBucket(buckets[CATEGORY_INDIAN]);
  buckets[CATEGORY_WESTERN] = sortBucket(buckets[CATEGORY_WESTERN]);
  return buckets;
}

/**
 * Build the play order by alternating between the Indian and Western buckets,
 * taking the top-ranked song of each bucket in turn. When one bucket runs
 * dry the other plays through. `lastPlayedCategory` seeds the rotation so the
 * next song always comes from the opposite bucket of the previous one.
 */
export function buildAlternatingQueue(submissions, lastPlayedCategory) {
  const unplayed = submissions.filter(item => !item.played).map(ensureCategory);
  const buckets = splitBuckets(unplayed);
  const order = [];
  let turn =
    lastPlayedCategory === CATEGORY_INDIAN ? CATEGORY_WESTERN :
    lastPlayedCategory === CATEGORY_WESTERN ? CATEGORY_INDIAN :
    pickStartingCategory(buckets);

  while (buckets[CATEGORY_INDIAN].length || buckets[CATEGORY_WESTERN].length) {
    if (!buckets[turn].length) {
      turn = otherCategory(turn);
    }
    order.push(buckets[turn].shift());
    turn = otherCategory(turn);
  }
  return order;
}

/**
 * Resolve which song is playing now and the alternating upcoming order.
 * Mutates `party.currentSubmissionId` when the pointer is stale and reports
 * whether anything changed so the caller can persist.
 */
export function resolvePlaybackState(party) {
  const submissions = (party.submissions || []).map(ensureCategory);
  let changed = false;
  let current = null;

  if (party.currentSubmissionId) {
    current = submissions.find(item => item.id === party.currentSubmissionId);
    if (!current || current.played) {
      party.currentSubmissionId = null;
      current = null;
      changed = true;
    }
  }

  const alternating = buildAlternatingQueue(submissions, party.lastPlayedCategory || null);

  if (!current) {
    current = alternating[0] || null;
    if (current && party.currentSubmissionId !== current.id) {
      party.currentSubmissionId = current.id;
      changed = true;
    }
  }

  // Upcoming order is projected as if the current song had just finished, so
  // the rotation continues from the current song's bucket.
  const remaining = submissions.filter(item => !item.played && (!current || item.id !== current.id));
  const upcoming = buildAlternatingQueue(
    remaining,
    current ? categoryOf(current) : party.lastPlayedCategory || null
  );

  const history = submissions
    .filter(item => item.played)
    .sort((a, b) => new Date(b.playedAt || 0).getTime() - new Date(a.playedAt || 0).getTime());

  return { current, upcoming, history, changed };
}

/** Mark a song as played and remember its bucket to drive alternation. */
export function markPlayed(party, submission, playedAt = new Date().toISOString()) {
  submission.played = true;
  submission.playedAt = playedAt;
  party.lastPlayedCategory = categoryOf(submission);
  if (party.currentSubmissionId === submission.id) {
    party.currentSubmissionId = null;
  }
  party.history = party.history || [];
  if (!party.history.includes(submission.id)) {
    party.history.push(submission.id);
  }
}
