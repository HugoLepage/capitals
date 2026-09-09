// Per-player statistics under /users/<name>:
//   stats/words/<WORD>          how many times the player spelled it
//   stats/record/bot/<level>    { wins, losses, draws, incomplete }
//   stats/record/human          { wins, losses, draws, incomplete }
//   stats/record/vs/<opponent>  { wins, losses, draws, incomplete }
//   stats/totals                { games, wins, losses, draws, incomplete, words }
//   matches/<id>                one record per game (online: id === room id)
//
// Every game is written as `incomplete` when it starts and flipped to its
// result when it ends, so an abandoned game simply stays incomplete.
// Multi-path updates only ever touch leaf paths (except when a match record
// is first created), so counters and fields written earlier are never wiped.

import {
  increment, limitToLast, onValue, orderByChild, push, query, ref, runTransaction,
  serverTimestamp, update,
} from 'firebase/database';
import { db, dbRef } from './firebase.js';

const BUCKET = { win: 'wins', loss: 'losses', draw: 'draws' };

// A stats claim on a finished room older than this is considered abandoned
// (the claiming tab died between claiming and writing) and may be retaken.
const CLAIM_TTL_MS = 30_000;

const rootUpdate = (updates) => update(ref(db), updates);

function startEntries(uname, matchId, match, buckets) {
  const u = `users/${uname}`;
  const out = { [`${u}/matches/${matchId}`]: match };
  for (const b of buckets) out[`${u}/stats/record/${b}/incomplete`] = increment(1);
  out[`${u}/stats/totals/games`] = increment(1);
  out[`${u}/stats/totals/incomplete`] = increment(1);
  return out;
}

function endEntries(uname, matchId, { result, endReason }, buckets) {
  const u = `users/${uname}`;
  const bucket = BUCKET[result];
  const out = {
    [`${u}/matches/${matchId}/result`]: result,
    [`${u}/matches/${matchId}/endReason`]: endReason || null,
    [`${u}/matches/${matchId}/endedAt`]: serverTimestamp(),
    [`${u}/stats/totals/incomplete`]: increment(-1),
    [`${u}/stats/totals/${bucket}`]: increment(1),
  };
  for (const b of buckets) {
    out[`${u}/stats/record/${b}/incomplete`] = increment(-1);
    out[`${u}/stats/record/${b}/${bucket}`] = increment(1);
  }
  return out;
}

// --- bot games -------------------------------------------------------------

export function startBotMatch(user, { level, lang }) {
  const matchId = push(dbRef('users', user.uname, 'matches')).key;
  const match = {
    mode: 'bot', level, lang, opponent: `bot-${level}`, result: 'incomplete',
    startedAt: serverTimestamp(), moves: 0,
  };
  rootUpdate(startEntries(user.uname, matchId, match, [`bot/${level}`]))
    .catch((err) => console.error('stats', err));
  return matchId;
}

export function endBotMatch(user, matchId, level, outcome) {
  return rootUpdate(endEntries(user.uname, matchId, outcome, [`bot/${level}`]))
    .catch((err) => console.error('stats', err));
}

// --- words -------------------------------------------------------------------

export function countWord(user, word, matchId) {
  const u = `users/${user.uname}`;
  const updates = {
    [`${u}/stats/words/${word.toUpperCase()}`]: increment(1),
    [`${u}/stats/totals/words`]: increment(1),
  };
  if (matchId) updates[`${u}/matches/${matchId}/moves`] = increment(1);
  return rootUpdate(updates).catch((err) => console.error('stats', err));
}

// --- online games -------------------------------------------------------------

// Both players' "game started" records, as multi-path entries so the caller
// can write them in the same update that creates the room.
export function onlineStartEntries(roomId, players, lang) {
  let updates = {};
  players.forEach((p, seat) => {
    const opp = players[1 - seat];
    const match = {
      mode: 'online', roomId, seat, lang, opponent: opp.uname, opponentName: opp.name,
      result: 'incomplete', startedAt: serverTimestamp(), moves: 0,
    };
    updates = { ...updates, ...startEntries(p.uname, roomId, match, ['human', `vs/${opp.uname}`]) };
  });
  return updates;
}

// Called by whoever sees the room end. A transaction on the room's
// `statsRecorded` flag hands the job to exactly one client at a time: it
// records a timestamped claim, writes both players' results together with
// the final `true` in one update, and a claim left behind by a tab that died
// in between can be retaken after CLAIM_TTL_MS. So a player who closed the
// tab still gets their record completed by the other side (or a later visit).
export async function finalizeOnlineMatch(room, claimant) {
  if (room.winner == null || room.statsRecorded === true) return false;
  let guard;
  try {
    guard = await runTransaction(dbRef('rooms', room.id, 'statsRecorded'), (v) => {
      if (v === true) return undefined;
      if (v && typeof v === 'object' && Date.now() - (v.at || 0) < CLAIM_TTL_MS) return undefined;
      return { by: claimant || 'anon', at: Date.now() };
    });
  } catch (err) {
    console.error('stats', err);
    return false;
  }
  if (!guard.committed) return false;

  let updates = { [`rooms/${room.id}/statsRecorded`]: true };
  room.players.forEach((p, seat) => {
    const opp = room.players[1 - seat];
    const result = room.winner === -1 ? 'draw' : room.winner === seat ? 'win' : 'loss';
    updates = {
      ...updates,
      ...endEntries(p.uname, room.id, { result, endReason: room.endReason }, ['human', `vs/${opp.uname}`]),
    };
  });
  try {
    await rootUpdate(updates);
    return true;
  } catch (err) {
    console.error('stats', err);
    return false;
  }
}

// --- lobby views ------------------------------------------------------------------

// cb({ record, words, totals }) on every change.
export function watchStats(uname, cb) {
  return onValue(dbRef('users', uname, 'stats'), (snap) => {
    const v = snap.val() || {};
    const words = Object.entries(v.words || {})
      .filter(([, n]) => typeof n === 'number' && n > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    cb({ record: v.record || {}, totals: v.totals || {}, words });
  }, () => cb({ record: {}, totals: {}, words: [] }));
}

// cb([match]) newest first.
export function watchRecentMatches(uname, cb, limit = 10) {
  const q = query(dbRef('users', uname, 'matches'), orderByChild('startedAt'), limitToLast(limit));
  return onValue(q, (snap) => {
    const list = [];
    snap.forEach((child) => {
      list.push({ id: child.key, ...child.val() });
    });
    list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    cb(list);
  }, () => cb([]));
}
