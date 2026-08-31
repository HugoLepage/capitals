// Dictionary loading and fast "which words can be formed from these letters"
// queries. Words are stored sorted by length (ascending) with a 26-bit letter
// mask each, so scans can prefilter cheaply and stop early.

const A_CODE = 65; // 'A'

// No realistic board offers more than a dozen usable letter tiles, and the
// word lists (the Italian one especially) are far cheaper to hold in memory
// once the unplayable long tail is dropped.
const MAX_WORD_LEN = 12;
const LETTERS_ONLY = /^[A-Za-z]+$/;

export function countsOf(letters) {
  const c = new Int8Array(26);
  for (const ch of letters) c[ch.charCodeAt(0) - A_CODE]++;
  return c;
}

function maskOfCounts(counts) {
  let m = 0;
  for (let i = 0; i < 26; i++) if (counts[i]) m |= 1 << i;
  return m;
}

export async function loadDictionary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch dictionary: ${res.status}`);
  const text = await res.text();

  const words = [];
  for (const line of text.split('\n')) {
    const w = line.trim();
    if (w.length >= 3 && w.length <= MAX_WORD_LEN && LETTERS_ONLY.test(w)) {
      words.push(w.toUpperCase());
    }
  }
  words.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

  const masks = new Int32Array(words.length);
  for (let i = 0; i < words.length; i++) {
    let m = 0;
    const w = words[i];
    for (let j = 0; j < w.length; j++) m |= 1 << (w.charCodeAt(j) - A_CODE);
    masks[i] = m;
  }

  const set = new Set(words);
  const threeLetterEnd = words.findIndex((w) => w.length > 3);

  const scratch = new Int8Array(26);
  function canForm(w, counts) {
    scratch.set(counts);
    for (let j = 0; j < w.length; j++) {
      if (--scratch[w.charCodeAt(j) - A_CODE] < 0) return false;
    }
    return true;
  }

  return {
    isWord: (w) => set.has(w),

    // True if at least one dictionary word can be spelled from `counts`
    // (with at most `totalLetters` letters available).
    hasAnyWord(counts, totalLetters) {
      const avail = maskOfCounts(counts);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.length > totalLetters) return false; // sorted by length
        if ((masks[i] & ~avail) === 0 && canForm(w, counts)) return true;
      }
      return false;
    },

    // All formable words up to maxLen letters.
    findWords(counts, maxLen, totalLetters) {
      const avail = maskOfCounts(counts);
      const cap = Math.min(maxLen, totalLetters);
      const out = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.length > cap) break;
        if ((masks[i] & ~avail) === 0 && canForm(w, counts)) out.push(w);
      }
      return out;
    },

    randomThreeLetterWord() {
      return words[(Math.random() * threeLetterEnd) | 0];
    },
  };
}
