// Game controller: DOM wiring, turn flow, and animations.
//
// Three modes share the board: 'local' (two players, one screen), 'bot', and
// 'online' (two signed-in players in a Firebase room; see rooms.js). Online,
// the mover computes the whole outcome of a move on a copy of the state and
// commits it with a transaction; both clients then animate the change when
// the room listener delivers it, so the two boards always match.

import { TILES } from './board.js';
import { loadDictionary, countsOf } from './dictionary.js';
import { newState, resolveMove, advanceTurn, ensurePlayable } from './rules.js';
import { chooseBotMove } from './bot.js';
import {
  LANGUAGES, applyStaticStrings, currentLanguage, detectLang, getLang, setLang, t,
} from './i18n.js';
import { currentUser } from './auth.js';
import {
  challengePlayer, closeMpOverlays, hasOutgoingChallenge, initLobby, isMpOverlayOpen, openLobby,
  requireLogin,
} from './lobby.js';
import {
  commitMove, createRoom, isValidRoomId, newRoomId, resignRoom, unpackTiles, watchRoom,
} from './rooms.js';
import { setPresenceRoom, watchPlayer } from './presence.js';
import {
  countWord, endBotMatch, finalizeOnlineMatch, onlineStartEntries, startBotMatch,
} from './stats.js';

const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : import.meta.env.BASE_URL + '/';

const wordsUrl = (lang) => BASE + lang.words;

const FLIP_MS = 560;
const FLIP_HALF = 280;

const CASTLE_SVG = `<svg class="castle" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" fill-rule="evenodd">
  <path d="M5 3 H8 V5.5 H10.6 V3 H13.4 V5.5 H16 V3 H19 V8.5 L17.4 10 V17.5 H19 V21 H5 V17.5 H6.6 V10 L5 8.5 Z
           M10.6 21 V17.4 A1.4 1.4 0 0 1 13.4 17.4 V21 Z"/>
</svg>`;

let dict = null;
let state = null;
let selection = [];
let busy = false;
let moveCount = 0;
let gen = 0; // incremented on every new game; async flows bail if it changed
let loadingWords = false;
let langLocked = false; // the picker is frozen while in an online room

// Online room the board is attached to (mode 'online' only).
// { roomId, seat (0|1|null for spectators), players, turn, unsub,
//   unsubPresence, opponentOnline, loaded, latest, pumping }
let online = null;

// Stats record of the bot game in progress, when signed in.
let botMatch = null; // { id, level, user }

// --- DOM handles -----------------------------------------------------------

const $ = (id) => document.getElementById(id);
let els = {};
let tileEls = [];

function cacheDom() {
  els = {
    grid: $('hex-grid'),
    boardWrap: document.querySelector('.board-wrap'),
    banner: $('turn-banner'),
    wordDisplay: $('word-display'),
    wordStatus: $('word-status'),
    btnClear: $('btn-clear'),
    btnPlay: $('btn-play'),
    btnResign: $('btn-resign'),
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    toast: $('toast'),
    setupOverlay: $('setup-overlay'),
    btnModeLocal: $('btn-mode-local'),
    btnModeBot: $('btn-mode-bot'),
    btnModeOnline: $('btn-mode-online'),
    difficultyRow: $('difficulty-row'),
    difficulty: $('difficulty'),
    difficultyValue: $('difficulty-value'),
    btnStart: $('btn-start'),
    btnSetupBack: $('btn-setup-back'),
    btnHowtoSetup: $('btn-howto-setup'),
    howtoOverlay: $('howto-overlay'),
    btnHowtoClose: $('btn-howto-close'),
    gameoverOverlay: $('gameover-overlay'),
    gameoverTitle: $('gameover-title'),
    gameoverSub: $('gameover-sub'),
    btnRematch: $('btn-rematch'),
    btnChangeMode: $('btn-change-mode'),
    btnNewGame: $('btn-new-game'),
    btnHelp: $('btn-help'),
    langPicker: $('lang-picker'),
    btnLang: $('btn-lang'),
    langMenu: $('lang-menu'),
  };
  tileEls = TILES.map((t) => $(`hex-${t.id}`));
}

// --- Helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isOnline = () => state !== null && state.mode === 'online' && online !== null;

function playerName(p) {
  if (state.mode === 'online') return online?.players[p]?.name || '?';
  if (state.mode === 'bot') return p === 0 ? t('player.you') : t('player.bot', state.botLevel);
  return p === 0 ? t('player.red') : t('player.blue');
}

// Tiles keep their colour identity even in bot mode, where the players are
// named "You" and "Bot" rather than Red and Blue.
const colorName = (p) => (p === 0 ? t('player.red') : t('player.blue'));

function turnLabel(p) {
  if (state.mode === 'online') {
    if (online.seat === null) return t('turn.of', playerName(p));
    return p === online.seat ? t('turn.yours') : t('turn.waiting', playerName(p));
  }
  if (state.mode === 'bot') return p === 0 ? t('turn.yours') : t('turn.botThinking');
  return p === 0 ? t('turn.red') : t('turn.blue');
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  els.toast.classList.remove('show');
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// --- Rendering -------------------------------------------------------------

function renderTile(tile) {
  const el = tileEls[tile.id];
  const selIdx = selection.indexOf(tile.id);
  let cls = 'hex';
  let label = t('tile.hidden');
  if (tile.kind === 'blank') {
    cls += ' is-blank';
  } else if (tile.kind === 'letter') {
    cls += ' is-letter';
    label = t('tile.letter', tile.letter);
  } else if (tile.kind === 'territory') {
    cls += ` is-territory p${tile.owner}`;
    label = t('tile.territory', colorName(tile.owner));
  } else {
    cls += ` is-base p${tile.owner}`;
    label = t('tile.base', colorName(tile.owner));
  }
  if (selIdx >= 0) cls += ` is-selected sel-p${state.currentPlayer}`;
  if (el.classList.contains('flipping')) cls += ' flipping';
  if (el.classList.contains('dealing')) cls += ' dealing';
  el.className = cls;
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-pressed', selIdx >= 0 ? 'true' : 'false');

  const content = el.querySelector('.hex-content');
  const html = tile.kind === 'base'
    ? CASTLE_SVG
    : tile.letter ? `<span class="hex-letter">${tile.letter}</span>` : '';
  if (content.innerHTML !== html) content.innerHTML = html;
  el.querySelector('.hex-badge').textContent = selIdx >= 0 ? selIdx + 1 : '';
}

function renderAll() {
  for (const tile of state.tiles) renderTile(tile);
}

// True when the person at this screen may not touch the board right now.
function inputBlocked() {
  if (!state) return true;
  if (state.mode === 'bot') return state.currentPlayer === 1;
  if (state.mode === 'online') return !online || online.seat === null || state.currentPlayer !== online.seat;
  return false;
}

function syncLock() {
  const locked = busy || !state || state.winner !== null || inputBlocked();
  els.grid.classList.toggle('locked', locked);
  els.grid.inert = locked; // also drops the 45 tile buttons from the tab order
  // Resigning is only for a seated player in a running online game.
  const canResign = isOnline() && online.seat !== null && state.winner === null;
  els.btnResign.classList.toggle('hidden', !canResign);
  if (!canResign) disarmResign();
}

function countOwned(p) {
  return state.tiles.filter((t) => t.owner === p).length;
}

function updateTurnBanner(botThinking = false) {
  let label;
  if (state.winner !== null) {
    if (state.winner === -1) label = t('turn.draw');
    else if (state.mode === 'bot') label = state.winner === 0 ? t('turn.youWin') : t('turn.botWins');
    else if (state.mode === 'online' && online?.seat === state.winner) label = t('turn.youWin');
    else label = t('turn.wins', playerName(state.winner));
  } else {
    label = botThinking ? t('turn.botThinking') : turnLabel(state.currentPlayer);
  }
  let presence = '';
  if (isOnline() && online.seat !== null) {
    const opp = playerName(1 - online.seat);
    const status = online.opponentOnline ? t('presence.online') : t('presence.offline');
    presence = `<span class="presence-dot${online.opponentOnline ? '' : ' off'}" ` +
      `title="${escapeHtml(opp)} · ${status}" aria-label="${escapeHtml(opp)} · ${status}"></span>`;
  }
  els.banner.innerHTML =
    `<span class="dot p0"></span><span class="score">${countOwned(0)}</span>` +
    `<span class="turn-label${state.winner === null ? ' p' + state.currentPlayer : ''}">${label}</span>` +
    `<span class="score">${countOwned(1)}</span><span class="dot p1"></span>${presence}`;
  syncLock();
}

function updateWordBar() {
  const word = selection.map((id) => state.tiles[id].letter).join('');
  if (word) {
    els.wordDisplay.textContent = word;
    els.wordDisplay.classList.remove('empty');
  } else {
    els.wordDisplay.textContent = t('word.prompt');
    els.wordDisplay.classList.add('empty');
  }
  const valid = word.length >= 3 && dict && dict.isWord(word);
  els.btnPlay.disabled = !valid || busy;
  els.btnClear.disabled = word.length === 0 || busy;
  let status = '', statusCls = 'word-status';
  if (word.length > 0 && word.length < 3) {
    status = t('word.tooShort');
  } else if (word.length >= 3) {
    status = valid ? t('word.valid') : t('word.invalid');
    statusCls += valid ? ' ok' : ' bad';
  }
  els.wordStatus.textContent = status;
  els.wordStatus.className = statusCls;
}

function addHistoryEntry(player, word) {
  els.historyEmpty.style.display = 'none';
  const li = document.createElement('li');
  li.className = `hist-row p${player}`;
  li.innerHTML = `<span class="hist-num">${++moveCount}</span><span class="hist-word">${escapeHtml(word.toLowerCase())}</span>`;
  els.historyList.appendChild(li);
  const panel = els.historyList.closest('.history-panel');
  panel.scrollTop = panel.scrollHeight;
}

function resetHistory() {
  moveCount = 0;
  els.historyList.innerHTML = '';
  els.historyEmpty.style.display = '';
}

// --- Animations ------------------------------------------------------------

function flipTile(id, delay = 0) {
  const el = tileEls[id];
  return new Promise((resolve) => {
    setTimeout(() => {
      el.classList.add('flipping');
      setTimeout(() => renderTile(state.tiles[id]), FLIP_HALF);
      setTimeout(() => {
        el.classList.remove('flipping');
        resolve();
      }, FLIP_MS + 40);
    }, delay);
  });
}

async function animateMove(res) {
  // 1. captured chain flips to territory, radiating out from the base
  if (res.captured.length) {
    await Promise.all(res.captured.map((id, i) => flipTile(id, i * 85)));
  }
  // 2. fallout: destroyed enemy tiles, revealed blanks, consumed letters
  const proms = [];
  res.destroyed.forEach((id, i) => proms.push(flipTile(id, i * 70)));
  res.revealed.forEach((id, i) => proms.push(flipTile(id, 140 + i * 70)));
  res.consumed.forEach((id, i) => proms.push(flipTile(id, 70 + i * 70)));
  if (res.baseDestroyed) {
    els.boardWrap.classList.add('shake');
    setTimeout(() => els.boardWrap.classList.remove('shake'), 600);
  }
  if (proms.length) await Promise.all(proms);
}

function dealInBoard() {
  for (const tile of state.tiles) {
    const el = tileEls[tile.id];
    el.style.animationDelay = `${(tile.col + tile.row) * 45 + Math.random() * 60}ms`;
    el.classList.add('dealing');
    el.addEventListener('animationend', () => {
      el.classList.remove('dealing');
      el.style.animationDelay = '';
    }, { once: true });
  }
  // CSS animations don't run while the tab is hidden; never leave tiles stuck
  // at the animation's invisible start state.
  setTimeout(() => {
    for (const el of tileEls) {
      el.classList.remove('dealing');
      el.style.animationDelay = '';
    }
  }, 1800);
}

// --- Turn flow -------------------------------------------------------------

function canPlayerMove(s) {
  const letters = s.tiles.filter((t) => t.kind === 'letter');
  if (letters.length < 3) return false;
  return dict.hasAnyWord(countsOf(letters.map((t) => t.letter)), letters.length);
}

const canCurrentPlayerMove = () => canPlayerMove(state);

// Pass the current player's turn (no playable word). Handles any pending
// base respawn, including rendering it.
async function passTurn(g) {
  const adv = advanceTurn(state, { winner: null, extraTurn: false });
  if (adv.respawned !== null) {
    await flipTile(adv.respawned, 150);
    if (g !== gen) return;
    toast(t('toast.respawn', playerName(state.currentPlayer)));
  }
}

function noWordsToast(player) {
  // "You have" vs "the bot has" — some languages inflect the verb too.
  const secondPerson = (state.mode === 'bot' && player === 0) ||
    (state.mode === 'online' && online?.seat === player);
  toast(secondPerson ? t('toast.noWordsYou', t('player.you')) : t('toast.noWords', playerName(player)));
}

async function handleNoMoves(g) {
  let passes = 0;
  while (state.winner === null && !canCurrentPlayerMove()) {
    noWordsToast(state.currentPlayer);
    await sleep(1000);
    if (g !== gen) return;
    await passTurn(g);
    if (g !== gen) return;
    if (++passes >= 2 && state.winner === null) {
      const c0 = countOwned(0), c1 = countOwned(1);
      state.winner = c0 === c1 ? -1 : c0 > c1 ? 0 : 1;
      state.endReason = 'stalemate';
      return;
    }
  }
  if (state.winner !== null && state.endReason === null) state.endReason = 'wipeout';
}

async function playMove(tileIds) {
  if (state.mode === 'online') return playOnlineMove(tileIds);

  const g = gen;
  busy = true;
  syncLock();
  const player = state.currentPlayer;
  const res = resolveMove(state, tileIds, player);
  selection = [];
  updateWordBar();
  addHistoryEntry(res.player, res.word);
  if (state.mode === 'bot' && player === 0 && botMatch) {
    countWord(botMatch.user, res.word, botMatch.id);
  }

  await animateMove(res);
  if (g !== gen) return;

  if (res.baseDestroyed && res.winner === null) {
    toast(t('toast.baseDown', playerName(player), playerName(1 - player)));
  }

  const adv = advanceTurn(state, res);
  if (adv.respawned !== null) {
    await flipTile(adv.respawned, 250);
    if (g !== gen) return;
    toast(t('toast.respawn', playerName(state.currentPlayer)));
  }

  if (state.winner === null) {
    const fixed = ensurePlayable(state, dict);
    if (fixed.length) {
      await Promise.all(fixed.map((id, i) => flipTile(id, i * 70)));
      if (g !== gen) return;
    }
    await handleNoMoves(g);
    if (g !== gen) return;
  }

  busy = false;
  updateTurnBanner();
  updateWordBar();

  if (state.winner !== null) {
    showGameOver();
    return;
  }
  maybeBotTurn();
}

function maybeBotTurn() {
  if (!state || state.mode !== 'bot' || state.winner !== null || state.currentPlayer !== 1) return;
  const g = gen;
  busy = true;
  updateTurnBanner(true);
  setTimeout(async () => {
    if (g !== gen) return;
    const ids = chooseBotMove(state, dict, state.botLevel, 1);
    if (!ids) {
      // Truly no playable word (defensive — handleNoMoves normally catches this).
      toast(t('toast.noWords', playerName(1)));
      await sleep(900);
      if (g !== gen) return;
      await passTurn(g);
      if (g !== gen) return;
      await handleNoMoves(g);
      if (g !== gen) return;
      busy = false;
      updateTurnBanner();
      updateWordBar();
      if (state.winner !== null) showGameOver();
      return;
    }
    const stepMs = Math.max(130, 420 - ids.length * 22);
    for (const id of ids) {
      if (g !== gen) return;
      selection.push(id);
      renderTile(state.tiles[id]);
      updateWordBar();
      await sleep(stepMs);
    }
    await sleep(400);
    if (g !== gen) return;
    await playMove(ids);
  }, 700);
}

// --- Online play -----------------------------------------------------------

// Run a complete move on a copy of `base` — the same sequence playMove
// performs on the live state, minus the animation — and describe every
// visible consequence so both clients can animate it identically.
function computeOnlineMove(base, tileIds, seat) {
  const sim = {
    tiles: base.tiles.map((t) => ({ ...t })),
    currentPlayer: base.currentPlayer,
    mode: 'online',
    botLevel: null,
    words: [],
    pendingRespawn: base.pendingRespawn,
    winner: null,
    endReason: null,
  };
  const res = resolveMove(sim, tileIds, seat);
  const adv = advanceTurn(sim, res);
  const lastMove = {
    by: seat,
    word: res.word,
    tileIds,
    captured: res.captured,
    consumed: res.consumed,
    revealed: res.revealed,
    destroyed: res.destroyed,
    baseDestroyed: res.baseDestroyed,
    extraTurn: res.extraTurn,
    respawned: adv.respawned,
    fixed: [],
    passes: [],
    stalemate: false,
  };
  if (sim.winner === null) {
    lastMove.fixed = ensurePlayable(sim, dict);
    let passes = 0;
    while (sim.winner === null && !canPlayerMove(sim)) {
      const passer = sim.currentPlayer;
      const a = advanceTurn(sim, { winner: null, extraTurn: false });
      lastMove.passes.push({ player: passer, respawned: a.respawned });
      if (++passes >= 2 && sim.winner === null) {
        const c0 = sim.tiles.filter((t) => t.owner === 0).length;
        const c1 = sim.tiles.filter((t) => t.owner === 1).length;
        sim.winner = c0 === c1 ? -1 : c0 > c1 ? 0 : 1;
        sim.endReason = 'stalemate';
        lastMove.stalemate = true;
        break;
      }
    }
  }
  // A wipe-out (immediate, or through a failed respawn) has no other reason.
  if (sim.winner !== null && sim.endReason === null) sim.endReason = 'wipeout';
  return { next: sim, lastMove, word: res.word };
}

async function playOnlineMove(tileIds) {
  if (!online || online.seat === null || state.currentPlayer !== online.seat) return;
  const g = gen;
  const seat = online.seat;
  const roomId = online.roomId;
  const expectedTurn = online.turn;
  busy = true;
  syncLock();

  const { next, lastMove, word } = computeOnlineMove(state, tileIds, seat);

  // Badges off before the flips render these tiles in their new state.
  selection = [];
  for (const id of tileIds) renderTile(state.tiles[id]);
  updateWordBar();

  // Offline, the transaction simply waits for the connection to come back;
  // say so rather than sit on a locked board in silence.
  const slowTimer = setTimeout(() => {
    if (g === gen) toast(t('toast.moveSlow'), 6000);
  }, 6000);
  let result;
  try {
    result = await commitMove(roomId, { expectedTurn, seat, next, word, lastMove });
  } catch (err) {
    console.error(err);
    clearTimeout(slowTimer);
    if (g !== gen) return;
    toast(t('toast.moveFailed'));
    if (!online.pumping) busy = false;
    updateTurnBanner();
    updateWordBar();
    return;
  }
  clearTimeout(slowTimer);
  if (g !== gen) return;

  if (!result.committed) {
    // Somebody else changed the room first; the listener has (or will have)
    // delivered the real position — just give the board back.
    toast(t('toast.outOfSync'));
    if (!online.pumping && online.turn !== expectedTurn + 1) busy = false;
    updateTurnBanner();
    updateWordBar();
    return;
  }

  // The room listener animates the committed move (for both players).
  const me = currentUser();
  if (me && online.players[seat]?.uname === me.uname) countWord(me, word, roomId);
}

const tilesDiffer = (a, b) => a.kind !== b.kind || a.owner !== b.owner || a.letter !== b.letter;

function stateFromRoom(room) {
  return {
    tiles: unpackTiles(room.tiles),
    currentPlayer: room.currentPlayer,
    mode: 'online',
    botLevel: null,
    words: room.words.map((w) => ({ player: w.player, word: w.word })),
    pendingRespawn: room.pendingRespawn,
    winner: room.winner,
    endReason: room.endReason,
  };
}

// Serialise room snapshots: one at a time, in order, each fully animated
// before the next is looked at.
function onRoomSnapshot(room) {
  online.latest = room;
  pumpRoom();
}

async function pumpRoom() {
  if (!online || online.pumping) return;
  const o = online;
  o.pumping = true;
  try {
    while (online === o && o.latest) {
      const room = o.latest;
      o.latest = null;
      if (!o.loaded) await firstRoomLoad(room);
      else await applyRoomUpdate(room);
    }
  } finally {
    o.pumping = false;
  }
}

async function firstRoomLoad(room) {
  const g = gen;
  const me = currentUser();
  const seatIdx = me ? room.players.findIndex((p) => p.uname === me.uname) : -1;
  online.players = room.players;
  online.seat = seatIdx >= 0 ? seatIdx : null;

  // The board was dealt from the room's language: dictionary and letter bag
  // must both follow it.
  const ok = await ensureLanguage(room.lang);
  if (g !== gen) return;
  if (!ok) {
    toast(t('toast.langFailed', currentLanguage().name));
    leaveRoom();
    openSetup();
    return;
  }

  state = stateFromRoom(room);
  online.turn = room.turn;
  online.loaded = true;
  selection = [];
  busy = false;
  botMatch = null;
  resetHistory();
  for (const w of room.words) addHistoryEntry(w.player, w.word);
  closeAllOverlays();
  hideToast();
  renderAll();
  dealInBoard();
  updateTurnBanner();
  updateWordBar();

  if (online.seat !== null) takeSeat(false);
  else toast(t('toast.spectating'));

  if (state.winner !== null) {
    showGameOver();
    if (room.statsRecorded !== true) finalizeOnlineMatch(room, me?.uname);
  }
}

// Seated: announce the room in presence and follow the opponent's presence.
function takeSeat(announce) {
  const g = gen;
  const o = online;
  // Only a running game counts as "in a game" for the lobby.
  setPresenceRoom(state.winner === null ? o.roomId : null);
  const opp = o.players[1 - o.seat];
  if (o.unsubPresence) o.unsubPresence();
  o.unsubPresence = watchPlayer(opp.uname, (p) => {
    if (g !== gen || online !== o) return;
    o.opponentOnline = !!(p && p.online);
    // Mid-animation the banner would reveal the final score early.
    if (state && !busy) updateTurnBanner();
  });
  if (announce) toast(t('toast.seated'));
  updateTurnBanner();
  updateWordBar();
}

// A spectator who signs in (or was signed out when the link opened) and turns
// out to be one of the two players gets their seat.
function refreshSeat() {
  const me = currentUser();
  if (!online || !online.loaded || online.seat !== null || !me) return;
  const idx = online.players.findIndex((p) => p.uname === me.uname);
  if (idx < 0) return;
  online.seat = idx;
  takeSeat(true);
  if (state.winner !== null) showGameOver();
}

async function applyRoomUpdate(room) {
  const g = gen;
  if (room.turn <= online.turn) return; // metadata only (or stale)

  busy = true;
  syncLock();
  const prevTiles = state.tiles;
  const newTiles = unpackTiles(room.tiles);
  const stepped = room.turn === online.turn + 1 && room.lastMove !== null;

  if (selection.length) {
    const old = selection;
    selection = [];
    for (const id of old) renderTile(prevTiles[id]);
  }
  for (let i = moveCount; i < room.words.length; i++) {
    addHistoryEntry(room.words[i].player, room.words[i].word);
  }

  // Swap the state first: flipTile re-renders each tile from `state` at the
  // midpoint of its flip, so the board reveals the new position tile by tile.
  state.tiles = newTiles;
  state.currentPlayer = room.currentPlayer;
  state.pendingRespawn = room.pendingRespawn;
  state.winner = room.winner;
  state.endReason = room.endReason;
  state.words = room.words.map((w) => ({ player: w.player, word: w.word }));
  online.turn = room.turn;
  updateWordBar();

  const changed = [];
  for (let i = 0; i < newTiles.length; i++) {
    if (tilesDiffer(prevTiles[i], newTiles[i])) changed.push(i);
  }
  const done = new Set();
  const take = (ids) => {
    const list = ids.filter((id) => !done.has(id));
    for (const id of list) done.add(id);
    return list;
  };

  if (stepped) {
    const m = room.lastMove;
    const captured = take(m.captured);
    if (captured.length) {
      await Promise.all(captured.map((id, i) => flipTile(id, i * 85)));
      if (g !== gen) return;
    }
    const proms = [];
    take(m.destroyed).forEach((id, i) => proms.push(flipTile(id, i * 70)));
    take(m.revealed).forEach((id, i) => proms.push(flipTile(id, 140 + i * 70)));
    take(m.consumed).forEach((id, i) => proms.push(flipTile(id, 70 + i * 70)));
    if (m.baseDestroyed) {
      els.boardWrap.classList.add('shake');
      setTimeout(() => els.boardWrap.classList.remove('shake'), 600);
    }
    if (proms.length) await Promise.all(proms);
    if (g !== gen) return;
    if (m.baseDestroyed && m.extraTurn) {
      toast(t('toast.baseDown', playerName(m.by), playerName(1 - m.by)));
    }
    if (m.respawned !== null) {
      take([m.respawned]);
      await flipTile(m.respawned, 250);
      if (g !== gen) return;
      toast(t('toast.respawn', playerName(newTiles[m.respawned].owner)));
    }
    const fixed = take(m.fixed);
    if (fixed.length) {
      await Promise.all(fixed.map((id, i) => flipTile(id, i * 70)));
      if (g !== gen) return;
    }
    for (const p of m.passes) {
      noWordsToast(p.player);
      await sleep(1000);
      if (g !== gen) return;
      if (p.respawned !== null) {
        take([p.respawned]);
        await flipTile(p.respawned, 150);
        if (g !== gen) return;
        toast(t('toast.respawn', playerName(newTiles[p.respawned].owner)));
      }
    }
  }
  // Anything that changed but was not choreographed (missed turns after a
  // reconnect, or a defensive catch-all) flips in a quick wave.
  const rest = take(changed);
  if (rest.length) {
    await Promise.all(rest.map((id, i) => flipTile(id, i * 35)));
    if (g !== gen) return;
  }

  busy = false;
  updateTurnBanner();
  updateWordBar();
  if (state.winner !== null) {
    setPresenceRoom(null); // free again as far as the lobby is concerned
    showGameOver();
    if (room.statsRecorded !== true) finalizeOnlineMatch(room, currentUser()?.uname);
  }
}

function setUrlSession(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  try {
    history[id ? 'pushState' : 'replaceState']({ session: id || null }, '', url);
  } catch {
    /* ignore */
  }
}

// Attach the board to a room. Everything about the room arrives through the
// listener; until then the previous game is frozen.
function enterRoom(roomId, { pushUrl = true } = {}) {
  if (!isValidRoomId(roomId)) {
    toast(t('toast.roomMissing'));
    return;
  }
  if (online && online.roomId === roomId) return;
  leaveRoom({ keepUrl: true });
  gen++;
  const g = gen;
  busy = true;
  if (state) syncLock();
  online = {
    roomId, seat: null, players: [], turn: -1, unsub: null, unsubPresence: null,
    opponentOnline: false, loaded: false, latest: null, pumping: false,
  };
  if (pushUrl) setUrlSession(roomId);
  closeAllOverlays();
  closeMpOverlays();
  lockLangPicker(true);
  toast(t('toast.roomLoading'), 30000); // replaced as soon as the board is up
  const o = online;
  o.unsub = watchRoom(roomId, (room, err) => {
    if (g !== gen || online !== o) return;
    if (err) console.error(err);
    if (!room) {
      if (!o.loaded) {
        toast(t('toast.roomMissing'));
        leaveRoom();
        closeMpOverlays();
        openSetup();
      }
      return; // a finished room deleted under us: keep showing it
    }
    onRoomSnapshot(room);
  });
}

// Give up the current online game after a second tap within three seconds.
let resignTimer = null;

function disarmResign() {
  if (!resignTimer) return;
  clearTimeout(resignTimer);
  resignTimer = null;
  els.btnResign.textContent = t('word.resign');
  els.btnResign.classList.remove('danger');
}

async function resign() {
  if (!isOnline() || online.seat === null || state.winner !== null) return;
  if (!resignTimer) {
    els.btnResign.textContent = t('word.resignConfirm');
    els.btnResign.classList.add('danger');
    resignTimer = setTimeout(disarmResign, 3000);
    return;
  }
  disarmResign();
  const g = gen;
  els.btnResign.disabled = true;
  try {
    const ok = await resignRoom(online.roomId, online.seat);
    if (g === gen && !ok) toast(t('toast.outOfSync'));
  } catch (err) {
    console.error(err);
    if (g === gen) toast(t('toast.moveFailed'));
  } finally {
    els.btnResign.disabled = false;
  }
}

function leaveRoom({ keepUrl = false } = {}) {
  if (!online) return;
  gen++;
  if (online.unsub) online.unsub();
  if (online.unsubPresence) online.unsubPresence();
  online = null;
  busy = false;
  setPresenceRoom(null);
  lockLangPicker(false);
  if (!keepUrl) setUrlSession(null);
}

// Create the room for an accepted challenge: fresh board in the challenge's
// language, random seats, both players' match records. Returns the room id.
async function acceptChallenge(ch) {
  const me = currentUser();
  if (!me) throw new Error('signed out');
  gen++; // freeze whatever game is running while the dictionary may change
  busy = true;
  if (state) syncLock();
  const ok = await ensureLanguage(ch.lang);
  if (!ok) throw new Error('dictionary'); // lobby.js calls onAcceptFailed
  const fresh = newState('online', null);
  ensurePlayable(fresh, dict);
  const challenger = { uname: ch.from, name: ch.fromName || ch.from };
  const mine = { uname: me.uname, name: me.name };
  const players = Math.random() < 0.5 ? [challenger, mine] : [mine, challenger];
  const id = newRoomId();
  // Room and both players' "game started" records go in one write.
  await createRoom({
    id, players, lang: ch.lang, tiles: fresh.tiles,
    extraUpdates: onlineStartEntries(id, players, ch.lang),
  });
  return id;
}

// Accepting fell through after the current game was frozen for it.
function onAcceptFailed() {
  busy = false;
  if (state) syncLock();
  openSetup();
}

async function onlineRematch() {
  if (!online || online.seat === null) {
    openSetup();
    return;
  }
  if (hasOutgoingChallenge()) {
    toast(t('over.rematchSent'), 4000);
    return;
  }
  if (!online.opponentOnline) {
    toast(t('over.rematchNeedsOpponent'));
    return;
  }
  const sent = await challengePlayer(online.players[1 - online.seat]);
  if (sent) toast(t('over.rematchSent'), 4000);
}

// A ?session link: show the board right away (as a spectator if need be) and,
// when signed out, offer to sign in so a participant can take their seat.
function joinFromUrl(roomId) {
  enterRoom(roomId, { pushUrl: false });
  if (!currentUser()) requireLogin(() => refreshSeat(), 'join');
}

// --- Game lifecycle --------------------------------------------------------

function closeAllOverlays() {
  els.setupOverlay.classList.remove('show');
  els.gameoverOverlay.classList.remove('show');
  els.howtoOverlay.classList.remove('show');
}

function newGame(mode, botLevel) {
  leaveRoom();
  gen++;
  state = newState(mode, botLevel);
  ensurePlayable(state, dict);
  selection = [];
  busy = false;
  resetHistory();
  closeAllOverlays();
  const user = currentUser();
  botMatch = mode === 'bot' && user
    ? { id: startBotMatch(user, { level: botLevel, lang: getLang() }), level: botLevel, user }
    : null;
  renderAll();
  dealInBoard();
  updateTurnBanner();
  updateWordBar();
}

function renderGameOverText() {
  const stalemate = state.endReason === 'stalemate';
  let title, sub;
  if (state.winner === -1) {
    title = t('turn.draw');
    sub = t('over.drawSub');
  } else if (state.mode === 'bot') {
    title = state.winner === 0 ? t('over.youWinTitle') : t('over.botWinsTitle');
    sub = stalemate
      ? t('over.stalemateSub', playerName(state.winner))
      : state.winner === 0
        ? t('over.youBeatBot', state.botLevel)
        : t('over.botBeatYou');
  } else if (state.mode === 'online' && online && online.seat !== null) {
    const resigned = state.endReason === 'resign';
    const winnerName = playerName(state.winner);
    const loserName = playerName(1 - state.winner);
    if (state.winner === online.seat) {
      title = t('over.youWinTitle');
      sub = resigned ? t('over.resigned', loserName)
        : stalemate ? t('over.stalemateSub', winnerName)
          : t('over.youBeat', loserName);
    } else {
      title = t('over.opponentWinsTitle', winnerName);
      sub = resigned ? t('over.youResigned')
        : stalemate ? t('over.stalemateSub', winnerName)
          : t('over.beatYou', winnerName);
    }
  } else {
    title = t('turn.wins', playerName(state.winner));
    sub = state.endReason === 'resign'
      ? t('over.resigned', playerName(1 - state.winner))
      : stalemate
        ? t('over.stalemateSub', playerName(state.winner))
        : t('over.wipedOut', playerName(1 - state.winner));
  }
  els.gameoverTitle.textContent = title;
  els.gameoverSub.textContent = sub;
}

function showGameOver() {
  renderGameOverText();
  // Spectators have nobody to rematch.
  els.btnRematch.classList.toggle('hidden', state.mode === 'online' && (!online || online.seat === null));
  if (state.mode === 'bot' && botMatch) {
    const result = state.winner === -1 ? 'draw' : state.winner === 0 ? 'win' : 'loss';
    endBotMatch(botMatch.user, botMatch.id, botMatch.level, {
      result, endReason: state.endReason || 'wipeout',
    });
    botMatch = null;
  }
  const g = gen;
  setTimeout(() => {
    if (g !== gen) return;
    els.gameoverOverlay.classList.add('show');
    els.btnRematch.focus();
  }, 900);
}

// --- Input -----------------------------------------------------------------

function onTileClick(e) {
  const el = e.target.closest('.hex');
  if (!el || busy || !state || !dict || state.winner !== null) return;
  if (inputBlocked()) return;
  const id = +el.dataset.id;
  const tile = state.tiles[id];
  if (tile.kind !== 'letter') {
    el.classList.remove('nope');
    void el.offsetWidth; // restart the animation
    el.classList.add('nope');
    return;
  }
  const idx = selection.indexOf(id);
  if (idx >= 0) {
    selection.splice(idx, 1);
    renderTile(tile);
    // renumber the badges of everything still selected
    for (const sid of selection) renderTile(state.tiles[sid]);
  } else {
    selection.push(id);
    renderTile(tile);
  }
  updateWordBar();
}

function clearSelection() {
  const old = selection;
  selection = [];
  for (const id of old) renderTile(state.tiles[id]);
  updateWordBar();
}

function submitWord() {
  if (els.btnPlay.disabled || busy) return;
  playMove([...selection]);
}

function onKeyDown(e) {
  if (isMpOverlayOpen()) return; // lobby.js owns its own overlays
  if (e.key === 'Escape' && isLangMenuOpen()) {
    closeLangMenu(true);
    return;
  }
  if (e.key === 'Escape' && els.howtoOverlay.classList.contains('show')) {
    els.howtoOverlay.classList.remove('show');
    return;
  }
  if (e.key === 'Escape' && els.setupOverlay.classList.contains('show') &&
      state && state.winner === null) {
    els.setupOverlay.classList.remove('show');
    return;
  }
  if (!state || busy || state.winner !== null) return;
  if (inputBlocked()) return;
  if (els.setupOverlay.classList.contains('show') || els.howtoOverlay.classList.contains('show')) return;
  // Enter on a focused button should activate that button, not submit the word.
  if (e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button, input'))) submitWord();
  else if (e.key === 'Escape') clearSelection();
  else if (e.key === 'Backspace') {
    if (selection.length) {
      const id = selection.pop();
      renderTile(state.tiles[id]);
      updateWordBar();
      e.preventDefault();
    }
  }
}

// --- Language picker -------------------------------------------------------

const isLangMenuOpen = () => !els.langMenu.hidden;

function renderLangPicker() {
  const cur = currentLanguage();
  els.btnLang.innerHTML = cur.flag;
  els.langMenu.innerHTML = '';
  for (const lang of LANGUAGES) {
    const li = document.createElement('li');
    const selected = lang.code === cur.code;
    li.className = 'lang-option' + (selected ? ' selected' : '');
    li.dataset.code = lang.code;
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(selected));
    li.innerHTML = `${lang.flag}<span>${lang.name}</span>`;
    els.langMenu.appendChild(li);
  }
}

function openLangMenu() {
  if (langLocked) return;
  els.langMenu.hidden = false;
  els.btnLang.setAttribute('aria-expanded', 'true');
  els.langMenu.querySelector('.lang-option.selected')?.focus();
}

function closeLangMenu(refocus = false) {
  els.langMenu.hidden = true;
  els.btnLang.setAttribute('aria-expanded', 'false');
  if (refocus) els.btnLang.focus();
}

// In an online room the language is the room's; the picker is frozen.
function lockLangPicker(locked) {
  langLocked = locked;
  if (locked) closeLangMenu();
  els.btnLang.disabled = locked || loadingWords;
}

// The board's letters are drawn from the language's own tile distribution and
// every word on it was validated against that language's list, so a switch
// re-deals rather than leaving a board the new dictionary can't explain.
async function selectLanguage(code) {
  closeLangMenu(true);
  if (loadingWords || langLocked || code === getLang()) return;

  setLang(code);
  const lang = currentLanguage();
  applyStaticStrings();
  renderLangPicker();
  if (state) {
    updateTurnBanner();
    updateWordBar();
    renderAll(); // tile aria-labels are translated too
    if (state.winner !== null) renderGameOverText();
  }

  const overlayUp = els.setupOverlay.classList.contains('show') ||
    els.gameoverOverlay.classList.contains('show');
  gen++; // cancel any bot turn or animation still in flight
  dict = null;
  busy = true;
  syncLock();
  toast(t('toast.langLoading', lang.name));

  const ok = await loadWords();
  if (getLang() !== lang.code) return; // a later switch owns the state now
  busy = false;
  if (!ok) {
    toast(t('toast.langFailed', lang.name));
    syncLock();
    return;
  }
  if (state && !overlayUp) {
    newGame(state.mode, state.botLevel);
    toast(t('toast.langNewGame', lang.name));
  } else {
    syncLock();
  }
}

// Make `code` the current language with its dictionary loaded, without
// touching the board (online rooms dictate their language, and that choice
// is not saved as the player's preference). Resolves true when the
// dictionary is ready.
async function ensureLanguage(code) {
  if (getLang() !== code) {
    setLang(code, false);
    applyStaticStrings();
    renderLangPicker();
    if (state) {
      updateTurnBanner();
      updateWordBar();
      renderAll();
      if (state.winner !== null) renderGameOverText();
    }
    dict = null;
  }
  // A load already in flight (for this or another language) always settles;
  // it only installs its dictionary if the language still matches.
  while (loadingWords) await sleep(50);
  if (dict && getLang() === code) return true;
  return loadWords();
}

function bindLangPicker() {
  els.btnLang.addEventListener('click', () => {
    if (isLangMenuOpen()) closeLangMenu();
    else openLangMenu();
  });
  els.langMenu.addEventListener('click', (e) => {
    const li = e.target.closest('.lang-option');
    if (li) selectLanguage(li.dataset.code);
  });
  els.langMenu.addEventListener('keydown', (e) => {
    const li = e.target.closest('.lang-option');
    if (li && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectLanguage(li.dataset.code);
    }
  });
  document.addEventListener('click', (e) => {
    if (isLangMenuOpen() && !els.langPicker.contains(e.target)) closeLangMenu();
  });
}

// --- Setup screen ----------------------------------------------------------

let chosenMode = 'bot';

function bindUi() {
  els.grid.addEventListener('click', onTileClick);
  els.btnPlay.addEventListener('click', submitWord);
  els.btnClear.addEventListener('click', clearSelection);
  document.addEventListener('keydown', onKeyDown);

  els.btnModeLocal.addEventListener('click', () => setMode('local'));
  els.btnModeBot.addEventListener('click', () => setMode('bot'));
  els.difficulty.addEventListener('input', () => {
    els.difficultyValue.textContent = els.difficulty.value;
  });
  els.btnStart.addEventListener('click', () => {
    if (!dict) { loadWords(); return; }
    newGame(chosenMode, +els.difficulty.value);
  });

  els.btnModeOnline.addEventListener('click', openLobby);
  els.btnResign.addEventListener('click', resign);

  els.btnNewGame.addEventListener('click', openSetup);
  els.btnChangeMode.addEventListener('click', openSetup);
  els.btnRematch.addEventListener('click', () => {
    if (state.mode === 'online') onlineRematch();
    else newGame(state.mode, state.botLevel);
  });
  els.btnSetupBack.addEventListener('click', () => els.setupOverlay.classList.remove('show'));
  els.setupOverlay.addEventListener('click', (e) => {
    if (e.target === els.setupOverlay && state && state.winner === null) {
      els.setupOverlay.classList.remove('show');
    }
  });

  const openHowto = () => {
    els.howtoOverlay.classList.add('show');
    els.btnHowtoClose.focus();
  };
  els.btnHelp.addEventListener('click', openHowto);
  els.btnHowtoSetup.addEventListener('click', openHowto);
  els.btnHowtoClose.addEventListener('click', () => els.howtoOverlay.classList.remove('show'));
  els.howtoOverlay.addEventListener('click', (e) => {
    if (e.target === els.howtoOverlay) els.howtoOverlay.classList.remove('show');
  });

  // The flag and Multiplayer button are only raised above the dim while the
  // setup or game-over dialog is up (see main.css), and those dialogs keep
  // clear of the top bar whatever its height.
  const syncDialogOpen = () => document.body.classList.toggle('dialog-open',
    els.setupOverlay.classList.contains('show') || els.gameoverOverlay.classList.contains('show'));
  const dialogObserver = new MutationObserver(syncDialogOpen);
  dialogObserver.observe(els.setupOverlay, { attributes: true, attributeFilter: ['class'] });
  dialogObserver.observe(els.gameoverOverlay, { attributes: true, attributeFilter: ['class'] });
  syncDialogOpen();
  const topbar = document.querySelector('.topbar');
  const syncTopbarHeight = () =>
    document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  new ResizeObserver(syncTopbarHeight).observe(topbar);
  syncTopbarHeight();

  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('session');
    if (id) {
      if (!online || online.roomId !== id) joinFromUrl(id);
    } else if (online) {
      leaveRoom({ keepUrl: true });
      openSetup();
    }
  });

  bindLangPicker();
}

function openSetup() {
  document.documentElement.classList.remove('joining'); // see Layout.astro
  els.gameoverOverlay.classList.remove('show');
  // Only a game still in progress can be returned to.
  els.btnSetupBack.classList.toggle('hidden', !state || state.winner !== null);
  els.setupOverlay.classList.add('show');
  els.btnStart.focus();
  if (!dict && !loadingWords) loadWords();
}

function setMode(mode) {
  chosenMode = mode;
  els.btnModeLocal.classList.toggle('selected', mode === 'local');
  els.btnModeBot.classList.toggle('selected', mode === 'bot');
  els.difficultyRow.classList.toggle('hidden', mode !== 'bot');
}

// Fetch the current language's word list. Resolves true once `dict` is ready.
// Only one load runs at a time (callers check `loadingWords`); a load whose
// language was switched away from mid-flight installs nothing, but always
// releases the flag so the next load can start.
async function loadWords() {
  loadingWords = true;
  els.btnStart.disabled = true;
  els.btnLang.disabled = true;
  els.btnStart.textContent = t('setup.loading');
  const lang = currentLanguage();
  try {
    const d = await loadDictionary(wordsUrl(lang));
    if (getLang() !== lang.code) return false; // superseded mid-flight
    dict = d;
    els.btnStart.textContent = t('setup.start');
    return true;
  } catch (err) {
    console.error(err);
    if (getLang() === lang.code) els.btnStart.textContent = t('setup.retry');
    return false;
  } finally {
    loadingWords = false;
    els.btnStart.disabled = false;
    els.btnLang.disabled = langLocked;
  }
}

const withTimeout = (promise, ms) => Promise.race([promise, sleep(ms).then(() => null)]);

export async function initGame() {
  cacheDom();
  setLang(detectLang());
  applyStaticStrings();
  renderLangPicker();
  bindUi();
  setMode('bot');

  const sessionId = new URLSearchParams(location.search).get('session');
  const lobbyReady = initLobby({
    toast,
    acceptChallenge,
    onAcceptFailed,
    enterRoom,
    roomHref: (id) => `?session=${encodeURIComponent(id)}`,
    onSignedIn: refreshSeat,
    onSignedOut: () => {
      if (online) {
        leaveRoom();
        openSetup();
      }
    },
    onLoginDismissed: () => {
      if (!state && !online) openSetup();
    },
  });

  if (sessionId && isValidRoomId(sessionId)) {
    // Straight into the room: no setup screen (Layout.astro hid it before
    // first paint), and the dictionary is the room's, not the browser's.
    els.setupOverlay.classList.remove('show');
    toast(t('toast.roomLoading'), 30000);
    await withTimeout(lobbyReady, 8000);
    joinFromUrl(sessionId);
  } else {
    if (sessionId) setUrlSession(null);
    document.documentElement.classList.remove('joining');
    loadWords();
    await lobbyReady;
  }
}
