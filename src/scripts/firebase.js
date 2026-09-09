// Firebase Realtime Database handle. The database URL is not a secret — access
// is governed by the database rules (see database.rules.json) — so it lives in
// the bundle like any other static asset.

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, runTransaction } from 'firebase/database';

export const DATABASE_URL =
  'https://capitals-9677a-default-rtdb.europe-west1.firebasedatabase.app';

const app = initializeApp({ databaseURL: DATABASE_URL });

export const db = getDatabase(app);

// `dbRef('rooms', id)` → ref to /rooms/<id>
export const dbRef = (...path) => ref(db, path.join('/'));

// runTransaction over a node that must already exist. The SDK hands the
// update function `null` when it has nothing cached for the path; `fn` never
// sees that — the attempt aborts and, if the server then shows the node does
// exist, runs once more against the now-cached value. Results are only ever
// server-confirmed (no optimistic local events).
export async function transact(nodeRef, fn) {
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let sawNull = false;
    res = await runTransaction(nodeRef, (cur) => {
      if (cur === null) {
        sawNull = true;
        return undefined;
      }
      return fn(cur);
    }, { applyLocally: false });
    if (res.committed || !sawNull || !res.snapshot.exists()) return res;
  }
  return res;
}
