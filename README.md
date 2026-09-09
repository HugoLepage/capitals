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

Three modes: local two-player on one screen, play against a bot with difficulty 1–10, or
play online against another person. The board is guaranteed to always contain at least
one spellable word.

## Multiplayer

The **Multiplayer** button in the top bar signs you in with just a username and a
password — a name nobody has used yet becomes a new account on the spot. Once signed in
it opens the lobby: everyone else who is online, with a **Challenge** button next to each
name, plus your record, your recent games and your most-played words.

A challenged player gets a card on their screen wherever they are (even mid-bot-game)
and can accept or decline. Accepting creates a game room and sends both players to
`?session=ROOM_ID`; the link can be shared, reloaded, or bookmarked — a player who is not
one of the two participants just watches. Each player can only move on their own turn,
and both boards animate every move identically. The game's language is fixed to the
challenger's language for its whole duration.

Everything lives in a Firebase Realtime Database — there is no server:

| Path | What it holds |
| --- | --- |
| `users/<name>/auth` | per-user salt and a verifier (SHA-256 of the PBKDF2-derived key) |
| `users/<name>/stats` | every word ever played (with a count), win / loss / draw / unfinished records per bot level, vs all humans and per opponent |
| `users/<name>/matches` | one record per game (bot or online), unfinished until it ends |
| `presence/<name>` | who is online and which room they are in |
| `challenges/<name>` | pending challenges addressed to that player |
| `rooms/<id>` | the full board, move counter, word history and the last move of every online game |

Every move is a database transaction that must advance the room's move counter, so two
clients can never apply a move to the same position. A game that is abandoned (new game,
closed tab) stays *unfinished* in both players' records; the game that finishes it, from
either side, completes both records at once.

The database URL is in `src/scripts/firebase.js`. `database.rules.json` holds the
recommended security rules — paste them into the Firebase console (Realtime Database →
Rules). They stop anyone from overwriting an existing account's password and reject
room writes that do not advance the move counter. Note that this is a casual game login,
not Firebase Authentication: the verifiers are readable, so players should not reuse
a password they care about.

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
