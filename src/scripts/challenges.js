// Challenges live under /challenges/<challenged player>/<id>. The challenger
// writes one, the challenged player answers by updating its status, and the
// challenger watches that status to learn the outcome.

import { onDisconnect, onValue, push, remove, serverTimestamp, set, update } from 'firebase/database';
import { dbRef, transact } from './firebase.js';

// A challenge nobody answered within this window is treated as expired, both
// by the challenger (who marks it) and by the recipient (who stops showing it
// even if the challenger's tab vanished before marking it).
export const CHALLENGE_TTL_MS = 60_000;

let serverOffset = 0;
let offsetStarted = false;

function trackServerTime() {
  if (offsetStarted) return;
  offsetStarted = true;
  onValue(dbRef('.info/serverTimeOffset'), (snap) => {
    serverOffset = snap.val() || 0;
  });
}

export const serverNow = () => Date.now() + serverOffset;

export function challengeRef(to, id) {
  return dbRef('challenges', to, id);
}

// Returns the new challenge id. A challenger whose tab dies leaves nothing
// behind: the server removes the node when the connection drops (the
// challenger's terminal-status handling removes it in every other case).
export async function sendChallenge({ from, to, lang }) {
  trackServerTime();
  const chRef = push(dbRef('challenges', to.uname));
  await onDisconnect(chRef).remove();
  await set(chRef, {
    id: chRef.key,
    from: from.uname,
    fromName: from.name,
    to: to.uname,
    toName: to.name,
    lang,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return chRef.key;
}

// cb(challenge | null) on every change; null once the node is gone.
export function watchChallenge(to, id, cb) {
  return onValue(challengeRef(to, id), (snap) => cb(snap.val()), () => cb(null));
}

// Move a challenge out of 'pending' — exactly once. Accept, decline, cancel and
// expire can race (the challenger's timer vs. the recipient's click), so the
// transition is a transaction that only succeeds from 'pending'. Resolves
// { ok, current } where `current` is the challenge as the server has it.
export async function setChallengeStatus(to, id, status, extra = {}) {
  const res = await transact(challengeRef(to, id), (cur) =>
    (cur.status === 'pending' ? { ...cur, ...extra, status, answeredAt: Date.now() } : undefined));
  return { ok: res.committed, current: res.snapshot.val() };
}

// Attach extra fields (e.g. the room id) to a challenge already claimed.
export function updateChallenge(to, id, fields) {
  return update(challengeRef(to, id), fields);
}

export function removeChallenge(to, id) {
  return remove(challengeRef(to, id)).catch(() => {});
}

export const isChallengeFresh = (ch) =>
  !!ch && ch.status === 'pending' &&
  (typeof ch.createdAt !== 'number' || serverNow() - ch.createdAt < CHALLENGE_TTL_MS);

// Anything older than twice the TTL is litter left by a challenger whose tab
// vanished; the recipient tidies it up.
const isChallengeLitter = (ch) =>
  !!ch && typeof ch.createdAt === 'number' && serverNow() - ch.createdAt > 2 * CHALLENGE_TTL_MS;

// cb receives the list of fresh pending challenges addressed to `me`.
export function watchIncoming(me, cb) {
  trackServerTime();
  return onValue(dbRef('challenges', me), (snap) => {
    const list = [];
    snap.forEach((child) => {
      const ch = child.val();
      if (isChallengeFresh(ch)) list.push({ ...ch, id: child.key });
      else if (isChallengeLitter(ch)) removeChallenge(me, child.key);
    });
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    cb(list);
  }, () => cb([]));
}
