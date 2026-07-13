import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlternatingQueue,
  resolvePlaybackState,
  splitBuckets,
  markPlayed,
  sortBucket
} from '../lib/queue.js';
import { classifyHeuristically, CATEGORY_INDIAN, CATEGORY_WESTERN } from '../lib/classifier.js';

let counter = 0;
function song({ category, title, votes = {}, priority = 0, played = false, createdAt } = {}) {
  counter += 1;
  return {
    id: `vid_${counter}`,
    title: title || `Song ${counter}`,
    channel: 'Test channel',
    category,
    votes,
    priority,
    played,
    createdAt: createdAt || new Date(2026, 0, 1, 0, 0, counter).toISOString()
  };
}

test('splitBuckets separates songs into indian and western buckets', () => {
  const submissions = [
    song({ category: CATEGORY_INDIAN }),
    song({ category: CATEGORY_WESTERN }),
    song({ category: CATEGORY_INDIAN })
  ];
  const buckets = splitBuckets(submissions);
  assert.equal(buckets[CATEGORY_INDIAN].length, 2);
  assert.equal(buckets[CATEGORY_WESTERN].length, 1);
});

test('sortBucket ranks by priority, then votes, then submission order', () => {
  const low = song({ category: CATEGORY_INDIAN, votes: { a: 1 } });
  const high = song({ category: CATEGORY_INDIAN, votes: { a: 1, b: 1, c: 1 } });
  const boosted = song({ category: CATEGORY_INDIAN, priority: Date.now() });
  const sorted = sortBucket([low, high, boosted]);
  assert.deepEqual(sorted.map(s => s.id), [boosted.id, high.id, low.id]);
});

test('buildAlternatingQueue alternates between buckets by rank', () => {
  const i1 = song({ category: CATEGORY_INDIAN, votes: { a: 1, b: 1 } });
  const i2 = song({ category: CATEGORY_INDIAN });
  const w1 = song({ category: CATEGORY_WESTERN, votes: { a: 1 } });
  const w2 = song({ category: CATEGORY_WESTERN });
  const order = buildAlternatingQueue([i2, w2, i1, w1], null);
  // i1 has the highest rank overall, so Indian starts, then strict alternation.
  assert.deepEqual(order.map(s => s.id), [i1.id, w1.id, i2.id, w2.id]);
});

test('buildAlternatingQueue starts from the bucket opposite the last played category', () => {
  const i1 = song({ category: CATEGORY_INDIAN, votes: { a: 1, b: 1, c: 1 } });
  const w1 = song({ category: CATEGORY_WESTERN });
  const order = buildAlternatingQueue([i1, w1], CATEGORY_INDIAN);
  assert.deepEqual(order.map(s => s.id), [w1.id, i1.id]);
});

test('buildAlternatingQueue drains the remaining bucket when the other is empty', () => {
  const w1 = song({ category: CATEGORY_WESTERN, votes: { a: 1 } });
  const w2 = song({ category: CATEGORY_WESTERN });
  const i1 = song({ category: CATEGORY_INDIAN });
  const order = buildAlternatingQueue([w1, w2, i1], CATEGORY_INDIAN);
  assert.deepEqual(order.map(s => s.id), [w1.id, i1.id, w2.id]);
});

test('resolvePlaybackState projects an alternating upcoming order after the current song', () => {
  const i1 = song({ category: CATEGORY_INDIAN, votes: { a: 1 } });
  const i2 = song({ category: CATEGORY_INDIAN });
  const w1 = song({ category: CATEGORY_WESTERN });
  const party = {
    submissions: [i1, i2, w1],
    currentSubmissionId: null,
    lastPlayedCategory: null,
    history: []
  };
  const playback = resolvePlaybackState(party);
  assert.equal(playback.current.id, i1.id);
  // Current is Indian, so the projection continues Western, Indian.
  assert.deepEqual(playback.upcoming.map(s => s.id), [w1.id, i2.id]);
});

test('markPlayed records the bucket so the next pick comes from the other bucket', () => {
  const i1 = song({ category: CATEGORY_INDIAN, votes: { a: 1, b: 1 } });
  const i2 = song({ category: CATEGORY_INDIAN, votes: { a: 1 } });
  const w1 = song({ category: CATEGORY_WESTERN });
  const party = {
    submissions: [i1, i2, w1],
    currentSubmissionId: i1.id,
    lastPlayedCategory: null,
    history: []
  };
  markPlayed(party, i1);
  assert.equal(party.lastPlayedCategory, CATEGORY_INDIAN);
  const playback = resolvePlaybackState(party);
  assert.equal(playback.current.id, w1.id, 'next song must come from the Western bucket');
  markPlayed(party, w1);
  const after = resolvePlaybackState(party);
  assert.equal(after.current.id, i2.id, 'rotation returns to the Indian bucket');
});

test('full playthrough alternates strictly while both buckets have songs', () => {
  const submissions = [
    song({ category: CATEGORY_INDIAN }),
    song({ category: CATEGORY_INDIAN }),
    song({ category: CATEGORY_INDIAN }),
    song({ category: CATEGORY_WESTERN }),
    song({ category: CATEGORY_WESTERN })
  ];
  const party = { submissions, currentSubmissionId: null, lastPlayedCategory: null, history: [] };
  const playedCategories = [];
  for (let i = 0; i < submissions.length; i += 1) {
    const playback = resolvePlaybackState(party);
    playedCategories.push(playback.current.category);
    markPlayed(party, playback.current);
  }
  for (let i = 1; i < playedCategories.length; i += 1) {
    const bothHadSongs = playedCategories.slice(i).includes(CATEGORY_INDIAN)
      && playedCategories.slice(i).includes(CATEGORY_WESTERN);
    if (bothHadSongs) {
      assert.notEqual(playedCategories[i], playedCategories[i - 1], 'adjacent songs must come from different buckets');
    }
  }
  assert.deepEqual([...playedCategories].sort(), ['indian', 'indian', 'indian', 'western', 'western']);
});

test('classifyHeuristically detects Indian songs via keywords and scripts', () => {
  assert.equal(classifyHeuristically({ title: 'Kesariya (Full Song) | Brahmāstra', channel: 'Sony Music India' }).category, CATEGORY_INDIAN);
  assert.equal(classifyHeuristically({ title: 'Tum Hi Ho - Arijit Singh', channel: 'T-Series' }).category, CATEGORY_INDIAN);
  assert.equal(classifyHeuristically({ title: 'तुम हि हो', channel: 'random channel' }).category, CATEGORY_INDIAN);
  assert.equal(classifyHeuristically({ title: 'நீ பார்த்த', channel: 'random' }).category, CATEGORY_INDIAN);
  assert.equal(classifyHeuristically({ title: 'Blinding Lights', channel: 'The Weeknd' }).category, CATEGORY_WESTERN);
  assert.equal(classifyHeuristically({ title: 'Bohemian Rhapsody', channel: 'Queen Official' }).category, CATEGORY_WESTERN);
});
