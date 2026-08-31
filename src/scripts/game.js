// Game controller: DOM wiring, turn flow, and animations.

import { TILES } from './board.js';
import { loadDictionary, countsOf } from './dictionary.js';
import { newState, resolveMove, advanceTurn, ensurePlayable } from './rules.js';
import { chooseBotMove } from './bot.js';
import {
  LANGUAGES, applyStaticStrings, currentLanguage, detectLang, getLang, setLang, t,
} from './i18n.js';

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
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    toast: $('toast'),
    setupOverlay: $('setup-overlay'),
    btnModeLocal: $('btn-mode-local'),
    btnModeBot: $('btn-mode-bot'),
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

function playerName(p) {
  if (state.mode === 'bot') return p === 0 ? t('player.you') : t('player.bot', state.botLevel);
  return p === 0 ? t('player.red') : t('player.blue');
}

// Tiles keep their colour identity even in bot mode, where the players are
// named "You" and "Bot" rather than Red and Blue.
const colorName = (p) => (p === 0 ? t('player.red') : t('player.blue'));

function turnLabel(p) {
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

function syncLock() {
  const locked = busy || !state || state.winner !== null ||
    (state.mode === 'bot' && state.currentPlayer === 1);
  els.grid.classList.toggle('locked', locked);
  els.grid.inert = locked; // also drops the 45 tile buttons from the tab order
}

function countOwned(p) {
  return state.tiles.filter((t) => t.owner === p).length;
}

function updateTurnBanner(botThinking = false) {
  let label;
  if (state.winner !== null) {
    label = state.winner === -1 ? t('turn.draw') :
      state.mode === 'bot'
        ? (state.winner === 0 ? t('turn.youWin') : t('turn.botWins'))
        : t('turn.wins', playerName(state.winner));
  } else {
    label = botThinking ? t('turn.botThinking') : turnLabel(state.currentPlayer);
  }
  els.banner.innerHTML =
    `<span class="dot p0"></span><span class="score">${countOwned(0)}</span>` +
    `<span class="turn-label${state.winner === null ? ' p' + state.currentPlayer : ''}">${label}</span>` +
    `<span class="score">${countOwned(1)}</span><span class="dot p1"></span>`;
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
  li.innerHTML = `<span class="hist-num">${++moveCount}</span><span class="hist-word">${word.toLowerCase()}</span>`;
  els.historyList.appendChild(li);
  const panel = els.historyList.closest('.history-panel');
  panel.scrollTop = panel.scrollHeight;
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

function canCurrentPlayerMove() {
  const letters = state.tiles.filter((t) => t.kind === 'letter');
  if (letters.length < 3) return false;
  return dict.hasAnyWord(countsOf(letters.map((t) => t.letter)), letters.length);
}

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

async function handleNoMoves(g) {
  let passes = 0;
  while (state.winner === null && !canCurrentPlayerMove()) {
    const name = playerName(state.currentPlayer);
    // "You have" vs "the bot has" — some languages inflect the verb too.
    const secondPerson = state.mode === 'bot' && state.currentPlayer === 0;
    toast(secondPerson ? t('toast.noWordsYou', name) : t('toast.noWords', name));
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
  const g = gen;
  busy = true;
  syncLock();
  const player = state.currentPlayer;
  const res = resolveMove(state, tileIds, player);
  selection = [];
  updateWordBar();
  addHistoryEntry(res.player, res.word);

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

// --- Game lifecycle --------------------------------------------------------

function newGame(mode, botLevel) {
  gen++;
  state = newState(mode, botLevel);
  ensurePlayable(state, dict);
  selection = [];
  busy = false;
  moveCount = 0;
  els.historyList.innerHTML = '';
  els.historyEmpty.style.display = '';
  els.setupOverlay.classList.remove('show');
  els.gameoverOverlay.classList.remove('show');
  els.howtoOverlay.classList.remove('show');
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
  } else {
    title = t('turn.wins', playerName(state.winner));
    sub = stalemate
      ? t('over.stalemateSub', playerName(state.winner))
      : t('over.wipedOut', playerName(1 - state.winner));
  }
  els.gameoverTitle.textContent = title;
  els.gameoverSub.textContent = sub;
}

function showGameOver() {
  renderGameOverText();
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
  if (state.mode === 'bot' && state.currentPlayer === 1) return;
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
  if (state.mode === 'bot' && state.currentPlayer === 1) return;
  if (els.setupOverlay.classList.contains('show') || els.howtoOverlay.classList.contains('show')) return;
  // Enter on a focused button should activate that button, not submit the word.
  if (e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button'))) submitWord();
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
  els.langMenu.hidden = false;
  els.btnLang.setAttribute('aria-expanded', 'true');
  els.langMenu.querySelector('.lang-option.selected')?.focus();
}

function closeLangMenu(refocus = false) {
  els.langMenu.hidden = true;
  els.btnLang.setAttribute('aria-expanded', 'false');
  if (refocus) els.btnLang.focus();
}

// The board's letters are drawn from the language's own tile distribution and
// every word on it was validated against that language's list, so a switch
// re-deals rather than leaving a board the new dictionary can't explain.
async function selectLanguage(code) {
  closeLangMenu(true);
  if (loadingWords || code === getLang()) return;

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

  els.btnNewGame.addEventListener('click', openSetup);
  els.btnChangeMode.addEventListener('click', openSetup);
  els.btnRematch.addEventListener('click', () => newGame(state.mode, state.botLevel));
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

  bindLangPicker();
}

function openSetup() {
  els.gameoverOverlay.classList.remove('show');
  // Only a game still in progress can be returned to.
  els.btnSetupBack.classList.toggle('hidden', !state || state.winner !== null);
  els.setupOverlay.classList.add('show');
  els.btnStart.focus();
}

function setMode(mode) {
  chosenMode = mode;
  els.btnModeLocal.classList.toggle('selected', mode === 'local');
  els.btnModeBot.classList.toggle('selected', mode === 'bot');
  els.difficultyRow.classList.toggle('hidden', mode !== 'bot');
}

// Fetch the current language's word list. Resolves true once `dict` is ready.
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
    if (getLang() === lang.code) {
      loadingWords = false;
      els.btnStart.disabled = false;
      els.btnLang.disabled = false;
    }
  }
}

export function initGame() {
  cacheDom();
  setLang(detectLang());
  applyStaticStrings();
  renderLangPicker();
  bindUi();
  setMode('bot');
  loadWords();
}
