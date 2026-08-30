// Pure game rules for Capitals. All functions mutate the state they are given
// and return event data describing what changed, so the UI (or the bot's
// simulations) can act on it.
//
// Tile kinds: 'blank' (hidden), 'letter' (revealed, neutral),
//             'territory' (owned, no letter), 'base' (owned capital).

import { TILES, BASES, neighborsOf } from './board.js';
import { randomLetter } from './letters.js';
import { countsOf } from './dictionary.js';

export function newState(mode, botLevel) {
  const tiles = TILES.map((t) => ({
    id: t.id, col: t.col, row: t.row,
    kind: 'blank', owner: null, letter: null,
  }));
  for (const player of [0, 1]) {
    const base = tiles[BASES[player]];
    base.kind = 'base';
    base.owner = player;
  }
  // Reveal the letters around each base.
  for (const player of [0, 1]) {
    for (const n of neighborsOf(BASES[player])) {
      const t = tiles[n];
      if (t.kind === 'blank') {
        t.kind = 'letter';
        t.letter = randomLetter();
      }
    }
  }
  return {
    tiles,
    currentPlayer: 0,
    mode,          // 'local' | 'bot'
    botLevel,      // 1..10 (bot mode only)
    words: [],     // [{ player, word }]
    pendingRespawn: null, // player index whose base respawns after the extra turn
    winner: null,
    endReason: null, // 'wipeout' | 'stalemate' once the game ends
  };
}

const ownsTile = (tile, player) =>
  tile.owner === player && (tile.kind === 'territory' || tile.kind === 'base');

// Play `tileIds` (letter tiles, in word order) for `player`.
export function resolveMove(state, tileIds, player) {
  const tiles = state.tiles;
  const word = tileIds.map((id) => tiles[id].letter).join('');
  const selected = new Set(tileIds);

  // Flood out from the player's territory through the selected tiles: those
  // chains get captured, the rest are consumed and re-rolled.
  const capturedSet = new Set();
  const captured = [];
  for (const id of tileIds) {
    if (!capturedSet.has(id) &&
        neighborsOf(id).some((n) => ownsTile(tiles[n], player))) {
      capturedSet.add(id);
      captured.push(id);
    }
  }
  for (let head = 0; head < captured.length; head++) {
    for (const n of neighborsOf(captured[head])) {
      if (selected.has(n) && !capturedSet.has(n)) {
        capturedSet.add(n);
        captured.push(n);
      }
    }
  }
  const consumed = tileIds.filter((id) => !capturedSet.has(id));

  for (const id of captured) {
    const t = tiles[id];
    t.kind = 'territory';
    t.owner = player;
    t.letter = null;
  }
  for (const id of consumed) tiles[id].letter = randomLetter();

  // Effects on the neighbours of newly captured tiles.
  const enemy = 1 - player;
  const revealed = [];
  const destroyed = [];
  let baseDestroyed = false;
  const seen = new Set();
  for (const id of captured) {
    for (const n of neighborsOf(id)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const t = tiles[n];
      if (t.kind === 'blank') {
        t.kind = 'letter';
        t.letter = randomLetter();
        revealed.push(n);
      } else if (t.owner === enemy && (t.kind === 'territory' || t.kind === 'base')) {
        if (t.kind === 'base') baseDestroyed = true;
        t.kind = 'letter';
        t.owner = null;
        t.letter = randomLetter();
        destroyed.push(n);
      }
    }
  }

  let winner = null;
  let extraTurn = false;
  if (baseDestroyed) {
    const enemyAlive = tiles.some((t) => t.owner === enemy);
    if (!enemyAlive) {
      winner = player; // wiped out: no base, no territory
    } else {
      extraTurn = true;
      state.pendingRespawn = enemy;
    }
  }

  state.words.push({ player, word });
  if (winner !== null) state.winner = winner;

  return { word, player, captured, consumed, revealed, destroyed, baseDestroyed, extraTurn, winner };
}

// Advance to the next turn after a resolved move (or a pass, with
// `moveResult = { winner: null, extraTurn: false }`).
// Returns { respawned } — the tile id of a respawned base, if any.
export function advanceTurn(state, moveResult) {
  if (moveResult.winner !== null) return { respawned: null };
  if (moveResult.extraTurn) return { respawned: null }; // same player again

  let respawned = null;
  if (state.pendingRespawn !== null) {
    const p = state.pendingRespawn;
    state.pendingRespawn = null;
    const territory = state.tiles.filter((t) => t.kind === 'territory' && t.owner === p);
    if (territory.length === 0) {
      state.winner = 1 - p; // nowhere to respawn: wiped out
      return { respawned: null };
    }
    const pick = territory[(Math.random() * territory.length) | 0];
    pick.kind = 'base';
    respawned = pick.id;
  }

  state.currentPlayer = 1 - state.currentPlayer;
  return { respawned };
}

// Guarantee at least one dictionary word can be formed from the letter tiles
// on the board. Mutates letters if needed; returns the ids of changed tiles.
// (With fewer than 3 letter tiles no word is possible; the game handles that
// case by passing the turn.)
export function ensurePlayable(state, dict) {
  const changed = new Set();
  const letterTiles = state.tiles.filter((t) => t.kind === 'letter');
  if (letterTiles.length < 3) return [];

  for (let attempt = 0; attempt < 80; attempt++) {
    const counts = countsOf(letterTiles.map((t) => t.letter));
    if (dict.hasAnyWord(counts, letterTiles.length)) return [...changed];
    const victim = letterTiles[(Math.random() * letterTiles.length) | 0];
    victim.letter = randomLetter();
    changed.add(victim.id);
  }

  // Still nothing (astronomically unlikely): stamp a random 3-letter word.
  const word = dict.randomThreeLetterWord();
  const shuffled = [...letterTiles].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3; i++) {
    shuffled[i].letter = word[i];
    changed.add(shuffled[i].id);
  }
  return [...changed];
}

// Deep-enough clone for bot simulations.
export function cloneState(state) {
  return {
    tiles: state.tiles.map((t) => ({ ...t })),
    currentPlayer: state.currentPlayer,
    mode: state.mode,
    botLevel: state.botLevel,
    words: [],
    pendingRespawn: state.pendingRespawn,
    winner: state.winner,
  };
}
