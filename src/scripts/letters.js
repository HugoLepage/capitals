// Random letters drawn from the current language's Scrabble tile
// distribution (blanks excluded).

import { currentLanguage } from './i18n.js';

let bag = null;
let bagLang = null;

function currentBag() {
  const lang = currentLanguage();
  if (bagLang !== lang.code) {
    bag = Object.entries(lang.bag).flatMap(([letter, n]) => Array(n).fill(letter));
    bagLang = lang.code;
  }
  return bag;
}

export const randomLetter = () => {
  const b = currentBag();
  return b[(Math.random() * b.length) | 0];
};
