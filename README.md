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
Letters are drawn from the Scrabble letter distribution, and the board is guaranteed to
always contain at least one spellable word.

The dictionary is the public-domain [ENABLE](https://github.com/dolph/dictionary) word list
(`public/words.txt`).

## Development

```sh
npm install
npm run dev      # dev server at http://localhost:4321/capitals
npm run build    # static build into dist/
```

Pushes to `main` deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`
(set the repository's Pages source to "GitHub Actions").
