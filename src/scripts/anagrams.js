// Convert word -> frequency array (26 letters a–z)
function wordToFreq(word) {
  const freq = new Array(26).fill(0);
  for (let char of word) {
    const idx = char.charCodeAt(0) - 97; // a=0, b=1, ...
    if (idx >= 0 && idx < 26) freq[idx]++;
  }
  return freq;
}

async function loadDictionary(path = "/words.txt") {
  // Use fetch() in the browser and fs.promises in Node
  let text;
  if (typeof fetch === "function") {
    // Browser / Vite: put the words file in the `public/` folder and use "/words.txt"
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
    text = await res.text();
  } else {
    // Node: dynamically import fs so bundlers don't include it for the browser
    const fs = await import("fs");
    text = await fs.promises.readFile(path, "utf8");
  }

  return text
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
    .map(word => ({ word, freq: wordToFreq(word), length: word.length }));
}

// Check if wordFreq can be formed from availableFreq
function canFormWord(wordFreq, availableFreq) {
  for (let i = 0; i < 26; i++) {
    if (wordFreq[i] > availableFreq[i]) return false;
  }
  return true;
}

// Main function
function findAnagrams(letters, dictionary) {
  const availableFreq = wordToFreq(letters.toLowerCase());
  const maxLen = letters.length;

  return dictionary
    .filter(entry => entry.length <= maxLen && canFormWord(entry.freq, availableFreq))
    .map(entry => entry.word);
}

// Example usage
// const dictionary = await loadDictionary("./Collins_Scrabble_Words_2019.txt");
// // Query many times with different letters
// console.log(findAnagrams("tac", dictionary));
// console.log(findAnagrams("dogcat", dictionary));
// console.log(findAnagrams("abcdefghijklmnopqrstuvwxyzzz", dictionary));

export default findAnagrams;
export { loadDictionary, wordToFreq, canFormWord };

// Expose helpers to window when running in a browser (for console testing)
if (typeof window !== "undefined") {
  window.loadDictionary = loadDictionary;
  window.findAnagrams = findAnagrams;
}