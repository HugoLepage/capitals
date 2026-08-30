// Bot opponent. Finds words spellable from the board's letter tiles, tries
// tile assignments that build capture chains, simulates each candidate move
// with the real rules, and scores the outcome. Difficulty 1-10 scales how
// many words it considers, how long they may be, how deliberately it places
// tiles, and how often it plays the best move it found.

import { neighborsOf, bfsDistances, TILE_COUNT } from './board.js';
import { resolveMove, cloneState } from './rules.js';
import { countsOf } from './dictionary.js';

const LEVELS = [
  { maxLen: 3,  sample: 8,   rollouts: 1, greedyP: 0.15, epsilon: 0.90, preferLong: false, wAdvance: 0, threat: false },
  { maxLen: 4,  sample: 12,  rollouts: 1, greedyP: 0.35, epsilon: 0.75, preferLong: false, wAdvance: 0, threat: false },
  { maxLen: 4,  sample: 18,  rollouts: 2, greedyP: 0.55, epsilon: 0.60, preferLong: false, wAdvance: 0, threat: false },
  { maxLen: 5,  sample: 26,  rollouts: 2, greedyP: 0.75, epsilon: 0.45, preferLong: false, wAdvance: 4, threat: false },
  { maxLen: 6,  sample: 40,  rollouts: 3, greedyP: 0.90, epsilon: 0.32, preferLong: true,  wAdvance: 5, threat: false },
  { maxLen: 7,  sample: 60,  rollouts: 3, greedyP: 1.0,  epsilon: 0.22, preferLong: true,  wAdvance: 6, threat: true  },
  { maxLen: 8,  sample: 90,  rollouts: 4, greedyP: 1.0,  epsilon: 0.15, preferLong: true,  wAdvance: 6, threat: true  },
  { maxLen: 10, sample: 140, rollouts: 4, greedyP: 1.0,  epsilon: 0.08, preferLong: true,  wAdvance: 7, threat: true  },
  { maxLen: 12, sample: 210, rollouts: 5, greedyP: 1.0,  epsilon: 0.03, preferLong: true,  wAdvance: 8, threat: true  },
  { maxLen: 15, sample: 320, rollouts: 6, greedyP: 1.0,  epsilon: 0.0,  preferLong: true,  wAdvance: 8, threat: true  },
];

const THREAT_PENALTY = { 1: 500, 2: 150, 3: 50, 4: 15 };

export function chooseBotMove(state, dict, level, player) {
  const cfg = LEVELS[Math.min(Math.max(level, 1), 10) - 1];
  const letterTiles = state.tiles.filter((t) => t.kind === 'letter');
  if (letterTiles.length < 3) return null;

  const counts = countsOf(letterTiles.map((t) => t.letter));
  let allWords = dict.findWords(counts, cfg.maxLen, letterTiles.length);
  // The level cap only shapes preference — if every spellable word is longer
  // than the cap, search again unrestricted rather than forfeiting the turn.
  if (allWords.length === 0) allWords = dict.findWords(counts, 28, letterTiles.length);
  if (allWords.length === 0) return null;
  const candidates = sampleWords(allWords, cfg);

  const enemy = 1 - player;
  const enemyBase = state.tiles.find((t) => t.kind === 'base' && t.owner === enemy);
  // Static tile desirability used by the greedy assignment.
  const distToEnemyBase = enemyBase
    ? bfsDistances([enemyBase.id], () => true)
    : new Array(TILE_COUNT).fill(8);
  const tileValue = (id) => {
    let v = (8 - Math.min(distToEnemyBase[id], 8)) * 0.5 + Math.random();
    for (const n of neighborsOf(id)) {
      const t = state.tiles[n];
      if (t.owner === enemy) v += t.kind === 'base' ? 60 : 3;
    }
    return v;
  };

  const scored = [];
  for (const word of candidates) {
    for (let k = 0; k < cfg.rollouts; k++) {
      const greedy = Math.random() < cfg.greedyP;
      const ids = assignTiles(state, letterTiles, word, player, greedy, tileValue);
      if (ids) scored.push({ ids, word, score: scoreMove(state, ids, player, cfg) });
    }
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const pick = Math.random() < cfg.epsilon
    ? scored[(Math.random() * scored.length) | 0]
    : scored[0];
  return pick.ids;
}

function sampleWords(words, cfg) {
  if (words.length <= cfg.sample) return words;
  const out = new Set();
  const half = cfg.sample >> 1;
  if (cfg.preferLong) {
    for (let i = words.length - half; i < words.length; i++) out.add(words[i]);
  } else {
    for (let i = 0; i < half; i++) out.add(words[i]);
  }
  while (out.size < cfg.sample) out.add(words[(Math.random() * words.length) | 0]);
  return [...out];
}

// Choose which specific tiles spell `word`. Greedy mode grows a connected
// chain out of the bot's territory so the letters actually get captured;
// random mode just grabs any matching tiles. Returns tile ids in word order.
function assignTiles(state, letterTiles, word, player, greedy, tileValue) {
  const byLetter = new Map(); // letter -> array of unused tile ids
  for (const t of letterTiles) {
    if (!byLetter.has(t.letter)) byLetter.set(t.letter, []);
    byLetter.get(t.letter).push(t.id);
  }

  const need = new Map(); // letter -> count still needed
  for (const ch of word) need.set(ch, (need.get(ch) || 0) + 1);

  const chosenByLetter = new Map(); // letter -> array of chosen tile ids
  const takeTile = (letter, id) => {
    const pool = byLetter.get(letter);
    pool.splice(pool.indexOf(id), 1);
    if (!chosenByLetter.has(letter)) chosenByLetter.set(letter, []);
    chosenByLetter.get(letter).push(id);
    need.set(letter, need.get(letter) - 1);
    if (need.get(letter) === 0) need.delete(letter);
  };

  if (greedy) {
    // Frontier = tiles adjacent to the bot's territory or to an already
    // chosen (and therefore connected) tile.
    const connected = new Set();
    const isConnectable = (id) =>
      neighborsOf(id).some((n) => {
        const t = state.tiles[n];
        return (t.owner === player && (t.kind === 'territory' || t.kind === 'base')) ||
               connected.has(n);
      });
    for (;;) {
      let best = null, bestVal = -Infinity;
      for (const [letter] of need) {
        for (const id of byLetter.get(letter)) {
          if (!isConnectable(id)) continue;
          const v = tileValue(id);
          if (v > bestVal) { bestVal = v; best = { letter, id }; }
        }
      }
      if (!best) break;
      takeTile(best.letter, best.id);
      connected.add(best.id);
    }
  }

  // Whatever is still needed (all of it, in random mode) gets random tiles.
  for (const [letter, count] of [...need]) {
    const pool = byLetter.get(letter);
    for (let i = 0; i < count; i++) {
      if (!pool || pool.length === 0) return null; // shouldn't happen
      takeTile(letter, pool[(Math.random() * pool.length) | 0]);
    }
  }

  // Order the chosen tiles to match the word's letter order.
  return [...word].map((ch) => chosenByLetter.get(ch).pop());
}

function scoreMove(state, tileIds, player, cfg) {
  const sim = cloneState(state);
  const res = resolveMove(sim, tileIds, player);
  // Winning includes the attrition path resolveMove can't see: if the enemy
  // base is already down (pending respawn) and this move wipes their last
  // territory, the respawn fails and they lose.
  if (res.winner === player || !sim.tiles.some((t) => t.owner === 1 - player)) return 1e9;

  let score =
    10 * res.captured.length +
    14 * res.destroyed.length +
    1 * res.revealed.length -
    2 * res.consumed.length +
    (res.baseDestroyed ? 400 : 0);

  const enemy = 1 - player;
  const isLetter = (id) => sim.tiles[id].kind === 'letter';

  if (cfg.wAdvance > 0) {
    // Fewer letter-steps between our territory and the enemy base = better.
    const enemyBase = sim.tiles.find((t) => t.kind === 'base' && t.owner === enemy);
    if (enemyBase) {
      const mine = sim.tiles.filter((t) => t.owner === player).map((t) => t.id);
      const dist = bfsDistances(mine, isLetter);
      let d = Infinity;
      for (const n of neighborsOf(enemyBase.id)) d = Math.min(d, dist[n]);
      score -= cfg.wAdvance * Math.min(d, 8);
    }
  }

  if (cfg.threat) {
    // How close (in capturable letter tiles) is the enemy to our base?
    const myBase = sim.tiles.find((t) => t.kind === 'base' && t.owner === player);
    if (myBase) {
      const theirs = sim.tiles.filter((t) => t.owner === enemy).map((t) => t.id);
      const dist = bfsDistances(theirs, isLetter);
      let d = Infinity;
      for (const n of neighborsOf(myBase.id)) d = Math.min(d, dist[n]);
      score -= THREAT_PENALTY[d] || 0;
    }
  }

  return score + Math.random() * 0.01;
}
