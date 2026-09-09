// Online game rooms: /rooms/<id> holds the whole board plus a move counter.
// Every move is a transaction that replaces the board and bumps `turn`, so two
// clients can never both apply a move to the same position.

import { onValue, ref, serverTimestamp, update } from 'firebase/database';
import { db, dbRef, transact } from './firebase.js';
import { TILES } from './board.js';

// The SDK throws on `undefined` anywhere in a value; a JSON round trip drops
// such fields (server-value sentinels are plain objects and survive it).
const clean = (v) => JSON.parse(JSON.stringify(v));

// Unambiguous characters only — the id ends up in a URL people may read aloud.
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRoomId(length = 10) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export const isValidRoomId = (id) => /^[a-z0-9]{6,20}$/.test(String(id || ''));

// --- (de)serialisation ------------------------------------------------------
// The database drops null fields and returns dense integer-keyed objects as
// arrays, so both directions are made explicit here.

export function packTiles(tiles) {
  return tiles.map((t) => ({
    kind: t.kind,
    owner: t.owner ?? null,
    letter: t.letter ?? null,
  }));
}

export function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  return Object.keys(v)
    .sort((a, b) => a - b)
    .map((k) => v[k])
    .filter((x) => x != null);
}

export function unpackTiles(raw) {
  const src = raw || [];
  return TILES.map((t) => {
    const r = src[t.id] || {};
    return {
      id: t.id, col: t.col, row: t.row,
      kind: r.kind || 'blank',
      owner: r.owner ?? null,
      letter: r.letter ?? null,
    };
  });
}

function normalizeMove(m) {
  if (!m) return null;
  return {
    by: m.by,
    word: m.word || '',
    tileIds: toArray(m.tileIds),
    captured: toArray(m.captured),
    consumed: toArray(m.consumed),
    revealed: toArray(m.revealed),
    destroyed: toArray(m.destroyed),
    baseDestroyed: !!m.baseDestroyed,
    respawned: m.respawned ?? null,
    fixed: toArray(m.fixed),
    passes: toArray(m.passes).map((p) => ({ player: p.player, respawned: p.respawned ?? null })),
    stalemate: !!m.stalemate,
  };
}

export function normalizeRoom(r) {
  if (!r) return null;
  return {
    id: r.id,
    lang: r.lang,
    status: r.status || 'active',
    players: toArray(r.players),
    turn: r.turn || 0,
    currentPlayer: r.currentPlayer || 0,
    pendingRespawn: r.pendingRespawn ?? null,
    winner: r.winner ?? null,
    endReason: r.endReason ?? null,
    tiles: r.tiles,
    words: toArray(r.words).map((w) => ({ player: w.p, word: w.w })),
    lastMove: normalizeMove(r.lastMove),
    // true once written; an object while some client is claiming the job
    statsRecorded: r.statsRecorded ?? false,
    createdAt: r.createdAt || 0,
    updatedAt: r.updatedAt || 0,
  };
}

// --- lifecycle --------------------------------------------------------------

// `players`: [{ uname, name }, { uname, name }] — seat 0 is red and moves first.
// `extraUpdates` (multi-path entries, e.g. both players' match records) land
// in the same write as the room, so a room can never exist without them.
export async function createRoom({ id, players, lang, tiles, extraUpdates = {} }) {
  const room = {
    id,
    lang,
    status: 'active',
    players,
    turn: 0,
    currentPlayer: 0,
    pendingRespawn: null,
    winner: null,
    endReason: null,
    tiles: packTiles(tiles),
    words: [],
    lastMove: null,
    statsRecorded: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await update(ref(db), clean({ [`rooms/${id}`]: room, ...extraUpdates }));
  return id;
}

// cb(room | null, error?) — null when the room does not exist.
export function watchRoom(id, cb) {
  return onValue(dbRef('rooms', id), (snap) => {
    cb(snap.exists() ? normalizeRoom(snap.val()) : null);
  }, (err) => cb(null, err));
}

// Atomically replace the board if it is still `seat`'s move at `expectedTurn`.
// `next` = { tiles, currentPlayer, pendingRespawn, winner, endReason },
// `lastMove` = the event record the listeners animate from.
// Resolves { committed, room } where `room` is the server's current value when
// the move was rejected.
export async function commitMove(id, { expectedTurn, seat, next, word, lastMove }) {
  const res = await transact(dbRef('rooms', id), (cur) => {
    if ((cur.turn || 0) !== expectedTurn || (cur.currentPlayer || 0) !== seat) return undefined;
    if (cur.winner != null || cur.status === 'finished') return undefined;
    const words = toArray(cur.words);
    words.push({ p: seat, w: word });
    return clean({
      ...cur,
      tiles: packTiles(next.tiles),
      currentPlayer: next.currentPlayer,
      pendingRespawn: next.pendingRespawn ?? null,
      winner: next.winner ?? null,
      endReason: next.endReason ?? null,
      status: next.winner != null ? 'finished' : 'active',
      turn: expectedTurn + 1,
      words,
      lastMove,
      updatedAt: Date.now(),
    });
  });
  return { committed: res.committed, room: normalizeRoom(res.snapshot.val()) };
}

// Give up: the opponent wins. Allowed on either player's turn while the game
// is still running. Listeners see a turn without a `lastMove` and no tile
// changes, then the game-over state.
export async function resignRoom(id, seat) {
  const res = await transact(dbRef('rooms', id), (cur) => {
    if (cur.winner != null || cur.status === 'finished') return undefined;
    return {
      ...cur,
      winner: 1 - seat,
      endReason: 'resign',
      status: 'finished',
      turn: (cur.turn || 0) + 1,
      lastMove: null,
      updatedAt: Date.now(),
    };
  });
  return res.committed;
}
