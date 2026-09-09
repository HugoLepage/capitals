// Username + password accounts stored in the Realtime Database.
//
// There is no Firebase Auth here (the project only exposes its database URL),
// so accounts are plain records under /users/<name>/auth. The browser derives
// a 256-bit key K = PBKDF2(password, salt) and the database stores only
// verifier = SHA-256(K). Signing in means proving you can produce K; the
// saved session keeps K locally, so the world-readable verifier alone is no
// use for forging one. This keeps the login as simple as asked — but it is a
// casual-game login, not a security boundary: anyone can read the verifiers,
// so players should not reuse a password they care about.

import { get, runTransaction, serverTimestamp, update } from 'firebase/database';
import { dbRef } from './firebase.js';

const SESSION_KEY = 'capitals.session';
const NAME_RE = /^[a-z0-9_-]{2,20}$/;
const PBKDF2_ITERATIONS = 100000;

let user = null; // { uname, name, key }
const listeners = new Set();

export const currentUser = () => user;
export const isSignedIn = () => user !== null;

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(user);
}

// Database keys may not contain . # $ [ ] / — the allowed set is stricter
// still so names stay readable everywhere they are shown.
export function normalizeName(raw) {
  const name = String(raw || '').trim();
  const uname = name.toLowerCase();
  return NAME_RE.test(uname) ? { uname, name } : null;
}

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'name' | 'password' | 'wrong' | 'crypto' | 'network'
  }
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

function subtle() {
  if (!globalThis.crypto?.subtle) throw new AuthError('crypto');
  return crypto.subtle;
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// The secret: PBKDF2-SHA256 of the password, as hex.
async function deriveKey(password, saltHex) {
  const enc = new TextEncoder();
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: PBKDF2_ITERATIONS },
    base,
    256,
  );
  return toHex(bits);
}

// What the database stores: SHA-256 of the key.
async function verifierOf(keyHex) {
  return toHex(await subtle().digest('SHA-256', fromHex(keyHex)));
}

function saveSession() {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session simply won't persist */
  }
}

async function readAuth(uname) {
  try {
    return (await get(dbRef('users', uname, 'auth'))).val();
  } catch (err) {
    console.error(err);
    throw new AuthError('network');
  }
}

async function readDisplayName(uname, fallback) {
  try {
    const profile = (await get(dbRef('users', uname, 'profile'))).val();
    return profile?.name || fallback;
  } catch {
    return fallback;
  }
}

// Sign in, creating the account if the name is free. Resolves to the user.
export async function login(rawName, password) {
  const parsed = normalizeName(rawName);
  if (!parsed) throw new AuthError('name');
  if (typeof password !== 'string' || password.length === 0 || password.length > 64) {
    throw new AuthError('password');
  }
  const { uname, name } = parsed;
  const authRef = dbRef('users', uname, 'auth');

  let existing = await readAuth(uname);

  if (!existing) {
    const salt = randomSalt();
    const key = await deriveKey(password, salt);
    const verifier = await verifierOf(key);
    // The transaction only creates the record if nobody registered the same
    // name in the meantime; if someone did, fall through to a normal check.
    let result;
    try {
      result = await runTransaction(authRef, (cur) =>
        (cur ? undefined : { salt, verifier, createdAt: Date.now() }));
    } catch (err) {
      console.error(err);
      throw new AuthError('network');
    }
    if (result.committed) {
      update(dbRef('users', uname, 'profile'), {
        name, createdAt: serverTimestamp(), lastLogin: serverTimestamp(),
      }).catch((err) => console.error(err)); // not fatal: the account exists
      user = { uname, name, key };
      saveSession();
      emit();
      return user;
    }
    existing = result.snapshot.val();
  }

  if (!existing.salt || !existing.verifier) throw new AuthError('wrong');
  const key = await deriveKey(password, existing.salt);
  if ((await verifierOf(key)) !== existing.verifier) throw new AuthError('wrong');

  const displayName = await readDisplayName(uname, name);
  update(dbRef('users', uname, 'profile'), { lastLogin: serverTimestamp() }).catch(() => {});
  user = { uname, name: displayName, key };
  saveSession();
  emit();
  return user;
}

// Restore a saved session by proving the stored key still matches the
// account's verifier — a hand-edited localStorage entry never counts.
export async function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (!saved?.uname || typeof saved.key !== 'string' || !/^[0-9a-f]{64}$/.test(saved.key)) {
    if (saved) saveSession(); // drop an old-format or damaged entry
    return null;
  }
  try {
    const auth = await readAuth(saved.uname);
    if (!auth?.verifier || (await verifierOf(saved.key)) !== auth.verifier) {
      user = null;
      saveSession();
      return null;
    }
    user = { uname: saved.uname, name: await readDisplayName(saved.uname, saved.name || saved.uname), key: saved.key };
    saveSession();
    emit();
    return user;
  } catch (err) {
    console.error(err);
    return null; // offline: stay signed out for now
  }
}

export function logout() {
  user = null;
  saveSession();
  emit();
}
