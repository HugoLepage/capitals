# Capitals

A word game of hexes and conquest, built with [Astro](https://astro.build) and vanilla
JavaScript. Fully static — hosted on GitHub Pages.

## How to play

- **Spell words** — tap any letter tiles on the board to make a valid word (3+ letters,
  one word per turn).
- **Capture tiles** — chains of played letters that touch your territory are captured.
  Blank tiles next to captured tiles are revealed; opponent tiles next to captured tiles
  turn back into letter tiles.
- **Go for the base** — destroying your opponent's base earns an extra turn. If they
  haven't lost, their base respawns on a random tile of their territory afterwards.
- **Wipe out your opponent to win.**

Two modes: local two-player on one screen, or play against a bot with difficulty 1–10.
The board is guaranteed to always contain at least one spellable word.

## Languages

The flag button in the top bar switches between English, French and Italian. The choice
is remembered in `localStorage`, and on a first visit the browser's own languages pick
the starting one. Because the tiles and the words on the board belong to a single
language, switching deals a fresh board.

Each language brings its own word list and its own tile distribution — the real Scrabble
one for that language, blanks excluded (English 98 tiles, French 100, Italian 118, which
has no J/K/W/X/Y at all). Both live together in `src/scripts/i18n.js`, alongside the
translated interface copy.

| Language | Word list | Source |
| --- | --- | --- |
| English | `public/words_en_Collins_Scrabble_Words_2019.txt` | Collins Scrabble Words 2019 |
| French | `public/words_fr_ODS8.txt` | ODS 8 |
| Italian | `public/words_it_sigmasaur.txt` | sigmasaur Italian word list |

The loader drops anything longer than 12 letters — no board can offer more — which keeps
the Italian list, a full inflected-forms dump, down to a size a browser can hold.

## Development

```sh
npm install
npm run dev      # dev server at http://localhost:4321/capitals
npm run build    # static build into dist/
```

Pushes to `main` deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`
(set the repository's Pages source to "GitHub Actions").
