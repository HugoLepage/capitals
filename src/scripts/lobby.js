// Multiplayer front door: the sign-in modal, the lobby (who is online, your
// record, recent games, favourite words) and the challenge cards that pop up
// wherever the player is. Game-side effects (loading a dictionary, creating
// a room, joining one) are delegated to game.js through `hooks`.

import { AuthError, currentUser, login, logout, onAuthChange, restoreSession } from './auth.js';
import { startPresence, stopPresence, watchOnlinePlayers } from './presence.js';
import {
  CHALLENGE_TTL_MS, isChallengeFresh, removeChallenge, sendChallenge, setChallengeStatus,
  updateChallenge, watchChallenge, watchIncoming,
} from './challenges.js';
import { watchRecentMatches, watchStats } from './stats.js';
import { getLang, languageOf, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
let els = {};
let hooks = null;

let players = [];
let stats = { record: {}, totals: {}, words: [] };
let recent = [];
let incoming = [];
let outgoing = null; // { id, to, toName, unsub, timer, roomTimer }

// How long the challenger waits for the room id after a challenge was claimed
// (the acceptor may be downloading a dictionary first).
const ROOM_WAIT_MS = 45_000;
let userUnsubs = []; // watchers tied to the signed-in user
let pruneTimer = null;
let afterLogin = null; // callback once a sign-in prompted for a purpose succeeds
let loginBusy = false;

// --- public API --------------------------------------------------------------

// hooks: { toast(msg), acceptChallenge(ch) → Promise<roomId>, enterRoom(id),
//          onSignedOut(), roomHref(id) }
// Resolves once a saved session has been checked (user or null).
export async function initLobby(h) {
  hooks = h;
  els = {
    btnMultiplayer: $('btn-multiplayer'),
    mpDot: $('mp-dot'),
    mpLabel: $('mp-label'),
    mpName: $('mp-name'),
    loginOverlay: $('login-overlay'),
    loginTag: $('login-tag'),
    loginForm: $('login-form'),
    loginName: $('login-name'),
    loginPassword: $('login-password'),
    loginError: $('login-error'),
    btnLogin: $('btn-login'),
    btnLoginCancel: $('btn-login-cancel'),
    lobbyOverlay: $('lobby-overlay'),
    lobbyModal: $('lobby-modal'),
    lobbyName: $('lobby-name'),
    btnLogout: $('btn-logout'),
    lobbyCount: $('lobby-count'),
    playerList: $('player-list'),
    playersEmpty: $('players-empty'),
    recordList: $('record-list'),
    recordEmpty: $('record-empty'),
    recentList: $('recent-list'),
    recentEmpty: $('recent-empty'),
    wordChips: $('word-chips'),
    wordsEmpty: $('words-empty'),
    btnLobbyClose: $('btn-lobby-close'),
    challengeStack: $('challenge-stack'),
  };
  bind();
  onAuthChange(onUserChange);
  renderTopbar();
  return restoreSession();
}

export const isLobbyOpen = () => els.lobbyOverlay.classList.contains('show');
export const isLoginOpen = () => els.loginOverlay.classList.contains('show');
export const isMpOverlayOpen = () => isLobbyOpen() || isLoginOpen();

// Ask for a sign-in and run `then` afterwards (used when a ?session link is
// opened while signed out).
export function requireLogin(then, hint = 'join') {
  if (currentUser()) {
    then(currentUser());
    return;
  }
  afterLogin = then;
  openLogin(hint);
}

export function openLobby() {
  if (!currentUser()) {
    openLogin('lobby');
    return;
  }
  els.loginOverlay.classList.remove('show');
  renderLobby();
  els.lobbyOverlay.classList.add('show');
  els.lobbyModal.scrollTop = 0;
  els.lobbyModal.focus({ preventScroll: true });
}

export function closeLobby() {
  els.lobbyOverlay.classList.remove('show');
}

export function closeMpOverlays() {
  closeLobby();
  closeLogin();
}

// Send a challenge to `player` ({ uname, name }); used by the lobby rows and
// by the game-over "Rematch" button in online games.
export async function challengePlayer(player) {
  const me = currentUser();
  if (!me || outgoing || player.uname === me.uname) return false;
  // If they challenged us first (both hit "Rematch"), accept theirs instead
  // of crossing it with a second challenge.
  const crossing = incoming.find((c) => c.from === player.uname);
  if (crossing) {
    const card = [...els.challengeStack.children].find((el) => el.dataset.id === crossing.id);
    if (card) {
      acceptIncoming(crossing, card);
      return true;
    }
  }
  const lang = getLang();
  let id;
  try {
    id = await sendChallenge({ from: me, to: player, lang });
  } catch (err) {
    console.error(err);
    hooks.toast(t('toast.challengeFailed'));
    return false;
  }
  const o = { id, to: player.uname, toName: player.name, unsub: null, timer: null, roomTimer: null };
  outgoing = o;
  o.timer = setTimeout(() => {
    if (outgoing === o) setChallengeStatus(player.uname, id, 'expired').catch(() => {});
  }, CHALLENGE_TTL_MS);
  const finish = (msg) => {
    if (outgoing !== o) return;
    clearOutgoing();
    removeChallenge(player.uname, id);
    renderPlayers();
    if (msg) hooks.toast(msg);
  };
  o.unsub = watchChallenge(player.uname, id, (ch) => {
    if (outgoing !== o) return;
    if (!ch) { // removed under us
      clearOutgoing();
      renderPlayers();
      return;
    }
    const name = player.name;
    switch (ch.status) {
      case 'pending':
        return;
      case 'accepted':
        if (ch.roomId) {
          finish(null);
          closeMpOverlays();
          hooks.enterRoom(ch.roomId);
        } else if (!o.roomTimer) {
          // Claimed; the acceptor is setting the room up. Stop the expiry
          // clock and give them a while to finish.
          clearTimeout(o.timer);
          o.roomTimer = setTimeout(() => finish(t('toast.challengeFailed')), ROOM_WAIT_MS);
        }
        return;
      case 'declined':
        finish(t('toast.challengeDeclined', name));
        return;
      case 'expired':
        finish(t('toast.challengeExpired', name));
        return;
      case 'failed':
        finish(t('toast.challengeFailed'));
        return;
      default:
        finish(null);
    }
  });
  hooks.toast(t('toast.challengeSent', player.name));
  renderPlayers();
  return true;
}

export const hasOutgoingChallenge = () => outgoing !== null;

// --- sign in / out ---------------------------------------------------------

function onUserChange(user) {
  stopUserWatchers();
  renderTopbar();
  if (user) {
    startPresence(user);
    userUnsubs.push(watchOnlinePlayers((list) => {
      players = list;
      renderPlayers();
    }));
    userUnsubs.push(watchIncoming(user.uname, (list) => {
      incoming = list;
      renderChallengeCards();
    }));
    userUnsubs.push(watchStats(user.uname, (s) => {
      stats = s;
      if (isLobbyOpen()) renderStats();
    }));
    userUnsubs.push(watchRecentMatches(user.uname, (list) => {
      recent = list;
      if (isLobbyOpen()) renderRecent();
    }));
    // A challenger who closed their tab never marks their challenge expired;
    // re-check ages every few seconds so stale cards disappear anyway.
    pruneTimer = setInterval(() => {
      const fresh = incoming.filter(isChallengeFresh);
      if (fresh.length !== incoming.length) {
        incoming = fresh;
        renderChallengeCards();
      }
    }, 5000);
    if (hooks.onSignedIn) hooks.onSignedIn(user);
  } else {
    players = [];
    incoming = [];
    stats = { record: {}, totals: {}, words: [] };
    recent = [];
    renderChallengeCards();
  }
}

function stopUserWatchers() {
  for (const u of userUnsubs) u();
  userUnsubs = [];
  clearInterval(pruneTimer);
  pruneTimer = null;
  clearOutgoing();
}

function clearOutgoing() {
  if (!outgoing) return;
  if (outgoing.unsub) outgoing.unsub();
  clearTimeout(outgoing.timer);
  clearTimeout(outgoing.roomTimer);
  outgoing = null;
}

// Withdraw our pending challenge. Resolves true when there is nothing left
// outstanding; false when the other side got in first (they accepted, and
// the watcher is taking us to their room).
async function cancelOutgoing() {
  if (!outgoing) return true;
  const o = outgoing;
  let res;
  try {
    res = await setChallengeStatus(o.to, o.id, 'cancelled');
  } catch (err) {
    console.error(err);
    res = { ok: false, current: null };
  }
  if (outgoing !== o) return res.ok || !(res.current && res.current.status === 'accepted');
  if (res.ok || !res.current || res.current.status !== 'accepted') {
    clearOutgoing();
    removeChallenge(o.to, o.id);
    renderPlayers();
    return true;
  }
  return false; // accepted under us: the watcher will follow it
}

function openLogin(hint) {
  els.loginTag.textContent = hint === 'join' ? t('login.joinTag') : t('login.tag');
  els.loginError.textContent = '';
  els.loginOverlay.classList.add('show');
  els.loginName.focus();
}

function closeLogin() {
  const wasOpen = isLoginOpen();
  els.loginOverlay.classList.remove('show');
  const purposeful = afterLogin !== null;
  afterLogin = null;
  if (wasOpen && purposeful && hooks.onLoginDismissed) hooks.onLoginDismissed();
}

function loginErrorText(err) {
  if (err instanceof AuthError) {
    switch (err.code) {
      case 'name': return t('login.errName');
      case 'password': return t('login.errPassword');
      case 'wrong': return t('login.errWrong');
      case 'crypto': return t('login.errCrypto');
      default: return t('login.errNetwork');
    }
  }
  return t('login.errNetwork');
}

async function submitLogin(e) {
  e.preventDefault();
  if (loginBusy) return;
  loginBusy = true;
  els.loginError.textContent = '';
  els.btnLogin.disabled = true;
  els.btnLogin.textContent = t('login.working');
  try {
    const user = await login(els.loginName.value, els.loginPassword.value);
    els.loginPassword.value = '';
    els.loginOverlay.classList.remove('show');
    hooks.toast(t('toast.signedIn', user.name));
    const then = afterLogin;
    afterLogin = null;
    if (then) then(user);
    else openLobby();
  } catch (err) {
    els.loginError.textContent = loginErrorText(err);
    (err instanceof AuthError && err.code === 'wrong' ? els.loginPassword : els.loginName).focus();
  } finally {
    loginBusy = false;
    els.btnLogin.disabled = false;
    els.btnLogin.textContent = t('login.submit');
  }
}

async function signOut() {
  await cancelOutgoing();
  closeMpOverlays();
  await stopPresence();
  logout();
  hooks.toast(t('toast.signedOut'));
  hooks.onSignedOut();
}

// --- rendering ------------------------------------------------------------

function renderTopbar() {
  const user = currentUser();
  els.mpDot.hidden = !user;
  els.mpLabel.hidden = !!user;
  els.mpName.hidden = !user;
  els.mpName.textContent = user ? user.name : '';
  els.btnMultiplayer.classList.toggle('signed-in', !!user);
}

function renderLobby() {
  const user = currentUser();
  els.lobbyName.textContent = user ? user.name : '';
  renderPlayers();
  renderStats();
  renderRecent();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function renderPlayers() {
  if (!els.playerList) return;
  els.lobbyCount.textContent = players.length ? String(players.length) : '';
  els.playersEmpty.hidden = players.length > 0;
  els.playerList.innerHTML = players.map((p) => {
    const waiting = outgoing && outgoing.to === p.uname;
    const inGame = !!p.room;
    const status = inGame ? t('lobby.inGame') : t('lobby.available');
    const action = waiting
      ? `<span class="player-status">${t('lobby.waiting')}</span>` +
        `<button class="btn ghost small" type="button" data-action="cancel" data-uname="${escapeHtml(p.uname)}">${t('lobby.cancel')}</button>`
      : `<button class="btn primary small" type="button" data-action="challenge" data-uname="${escapeHtml(p.uname)}"` +
        `${inGame || outgoing ? ' disabled' : ''}>${t('lobby.challenge')}</button>`;
    return `<li class="player-row${waiting ? ' waiting' : ''}">` +
      `<span class="presence-dot" aria-hidden="true"></span>` +
      `<span class="player-name">${escapeHtml(p.name)}</span>` +
      (waiting ? '' : `<span class="player-status">${status}</span>`) +
      action + '</li>';
  }).join('');
}

const nonNeg = (n) => Math.max(0, n || 0);

function recordLine(r) {
  return t('lobby.recordLine', nonNeg(r.wins), nonNeg(r.losses), nonNeg(r.draws), nonNeg(r.incomplete));
}

const hasGames = (r) => r && ((r.wins || 0) + (r.losses || 0) + (r.draws || 0) + (r.incomplete || 0)) > 0;

function renderStats() {
  const rows = [];
  const rec = stats.record || {};
  if (hasGames(rec.human)) rows.push([t('lobby.vsHumans'), recordLine(rec.human)]);
  for (const [uname, r] of Object.entries(rec.vs || {}).sort()) {
    if (hasGames(r)) rows.push([t('lobby.vsName', uname), recordLine(r)]);
  }
  for (const level of Object.keys(rec.bot || {}).map(Number).sort((a, b) => a - b)) {
    const r = rec.bot[level];
    if (hasGames(r)) rows.push([t('lobby.vsBot', level), recordLine(r)]);
  }
  els.recordEmpty.hidden = rows.length > 0;
  els.recordList.innerHTML = rows.map(([who, line]) =>
    `<div class="record-row"><span class="record-who">${escapeHtml(who)}</span><span class="record-line">${escapeHtml(line)}</span></div>`,
  ).join('');

  const words = stats.words.slice(0, 12);
  els.wordsEmpty.hidden = words.length > 0;
  els.wordChips.innerHTML = words.map(([w, n]) =>
    `<span class="word-chip">${escapeHtml(w)}<small>×${n}</small></span>`,
  ).join('');
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString(getLang(), { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function renderRecent() {
  els.recentEmpty.hidden = recent.length > 0;
  els.recentList.innerHTML = recent.map((m) => {
    const opponent = m.mode === 'bot' ? t('opp.bot', m.level) : (m.opponentName || m.opponent || '?');
    const result = m.result || 'incomplete';
    const link = m.mode === 'online' && m.roomId
      ? `<a class="recent-open" href="${escapeHtml(hooks.roomHref(m.roomId))}" data-room="${escapeHtml(m.roomId)}">${t('lobby.open')}</a>`
      : '';
    return `<li class="recent-row">` +
      `<span class="recent-when">${escapeHtml(formatDate(m.startedAt))}</span>` +
      `<span class="recent-opp">${escapeHtml(opponent)}</span>` +
      `<span class="pill ${result}">${escapeHtml(t('result.' + result))}</span>${link}</li>`;
  }).join('');
}

function renderChallengeCards() {
  const stack = els.challengeStack;
  const shown = new Set([...stack.children].map((el) => el.dataset.id));
  const wanted = new Set(incoming.map((ch) => ch.id));
  for (const el of [...stack.children]) if (!wanted.has(el.dataset.id)) el.remove();
  for (const ch of incoming) {
    if (shown.has(ch.id)) continue;
    const card = document.createElement('div');
    card.className = 'challenge-card';
    card.dataset.id = ch.id;
    card.setAttribute('role', 'alertdialog');
    card.innerHTML =
      `<div class="challenge-text">${t('challenge.text', `<b>${escapeHtml(ch.fromName || ch.from)}</b>`, escapeHtml(languageOf(ch.lang).name))}</div>` +
      `<div class="challenge-actions">` +
      `<button class="btn ghost small" type="button" data-action="decline">${t('challenge.decline')}</button>` +
      `<button class="btn primary small" type="button" data-action="accept">${t('challenge.accept')}</button>` +
      `</div>`;
    stack.appendChild(card);
  }
}

// --- challenge answers -------------------------------------------------------

function dropCard(id) {
  incoming = incoming.filter((c) => c.id !== id);
  renderChallengeCards();
}

async function acceptIncoming(ch, card) {
  const me = currentUser();
  if (!me) return;
  if (!isChallengeFresh(ch)) {
    dropCard(ch.id);
    hooks.toast(t('toast.challengeExpired', ch.fromName || ch.from));
    return;
  }
  for (const b of card.querySelectorAll('button')) b.disabled = true;

  // Our own challenge to someone may have been accepted meanwhile — then we
  // are on our way to that room and this one is declined instead.
  if (!(await cancelOutgoing())) {
    dropCard(ch.id);
    setChallengeStatus(me.uname, ch.id, 'declined').catch(() => {});
    return;
  }

  // Claim first (only one answer can win), then build the room, then tell the
  // challenger where it is.
  let claim;
  try {
    claim = await setChallengeStatus(me.uname, ch.id, 'accepted');
  } catch (err) {
    console.error(err);
    claim = { ok: false };
  }
  if (!claim.ok) {
    dropCard(ch.id);
    hooks.toast(t('toast.challengeGone'));
    return;
  }
  dropCard(ch.id);
  try {
    const roomId = await hooks.acceptChallenge(ch);
    await updateChallenge(me.uname, ch.id, { roomId });
    closeMpOverlays();
    hooks.enterRoom(roomId);
  } catch (err) {
    console.error(err);
    updateChallenge(me.uname, ch.id, { status: 'failed' }).catch(() => {});
    hooks.toast(t('toast.challengeFailed'));
    if (hooks.onAcceptFailed) hooks.onAcceptFailed();
  }
}

function declineIncoming(ch) {
  const me = currentUser();
  dropCard(ch.id);
  if (me) setChallengeStatus(me.uname, ch.id, 'declined').catch(() => {});
}

// --- wiring -------------------------------------------------------------------

function bind() {
  els.btnMultiplayer.addEventListener('click', openLobby);
  els.loginForm.addEventListener('submit', submitLogin);
  els.btnLoginCancel.addEventListener('click', closeLogin);
  els.loginOverlay.addEventListener('click', (e) => {
    if (e.target === els.loginOverlay) closeLogin();
  });
  els.btnLogout.addEventListener('click', signOut);
  els.btnLobbyClose.addEventListener('click', closeLobby);
  els.lobbyOverlay.addEventListener('click', (e) => {
    if (e.target === els.lobbyOverlay) closeLobby();
  });

  els.playerList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const player = players.find((p) => p.uname === btn.dataset.uname);
    if (btn.dataset.action === 'challenge' && player) challengePlayer(player);
    else if (btn.dataset.action === 'cancel') cancelOutgoing();
  });

  els.recentList.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-room]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    closeMpOverlays();
    hooks.enterRoom(a.dataset.room);
  });

  els.challengeStack.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    const card = e.target.closest('.challenge-card');
    if (!btn || !card) return;
    const ch = incoming.find((c) => c.id === card.dataset.id);
    if (!ch) return;
    if (btn.dataset.action === 'accept') acceptIncoming(ch, card);
    else declineIncoming(ch);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isLobbyOpen()) closeLobby();
    else if (isLoginOpen() && !loginBusy) closeLogin();
  });
}
