// Language configuration and UI strings.
//
// Each language ties together three things: the word list fetched from
// /public, the Scrabble letter distribution its tiles are drawn from, and the
// translated interface copy.

// Flag icons are drawn inline rather than with emoji — Windows ships no glyphs
// for the regional-indicator pairs, so 🇫🇷 would render there as bare "FR".
// The rounded corners come from `clip-path` on .flag (see main.css) so the
// same markup can be stamped out twice without duplicating element ids.
const flag = (body) => `<svg class="flag" viewBox="0 0 60 40" aria-hidden="true">${body}
  <rect class="flag-edge" x="1" y="1" width="58" height="38" rx="5" fill="none" stroke="rgba(70,45,10,0.3)" stroke-width="2" />
</svg>`;

const FLAG_GB = flag(`
  <rect width="60" height="40" fill="#012169" />
  <path d="M0 0 L60 40 M60 0 L0 40" stroke="#fff" stroke-width="9" />
  <path d="M0 0 L60 40 M60 0 L0 40" stroke="#C8102E" stroke-width="4" />
  <path d="M30 0 V40 M0 20 H60" stroke="#fff" stroke-width="14" />
  <path d="M30 0 V40 M0 20 H60" stroke="#C8102E" stroke-width="8" />`);

const FLAG_FR = flag(`
  <rect width="20" height="40" fill="#002654" />
  <rect x="20" width="20" height="40" fill="#ffffff" />
  <rect x="40" width="20" height="40" fill="#ED2939" />`);

const FLAG_IT = flag(`
  <rect width="20" height="40" fill="#008C45" />
  <rect x="20" width="20" height="40" fill="#F4F5F0" />
  <rect x="40" width="20" height="40" fill="#CD212A" />`);

// Scrabble tile distributions, blanks excluded:
// English 98 tiles, French 100, Italian 118.
const BAG_EN = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4,
  M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1,
  Y: 2, Z: 1,
};

const BAG_FR = {
  A: 9, B: 2, C: 2, D: 3, E: 15, F: 2, G: 2, H: 2, I: 8, J: 1, K: 1, L: 5,
  M: 3, N: 6, O: 6, P: 2, Q: 1, R: 6, S: 6, T: 6, U: 6, V: 2, W: 1, X: 1,
  Y: 1, Z: 1,
};

// Italian Scrabble has no J, K, W, X or Y tiles at all.
const BAG_IT = {
  A: 14, B: 3, C: 6, D: 3, E: 11, F: 3, G: 2, H: 2, I: 12, L: 5, M: 5,
  N: 5, O: 15, P: 3, Q: 1, R: 6, S: 6, T: 6, U: 5, V: 3, Z: 2,
};

// Values are plain strings, or functions when the copy takes arguments.
const STRINGS = {
  en: {
    'lang.pick': 'Language',
    'theme.toggle': 'Toggle dark mode',
    'top.help': 'How to play',
    'top.newGame': 'New game',
    'word.prompt': 'Tap letters to spell a word',
    'word.clear': 'Clear',
    'word.play': 'Play word',
    'word.tooShort': 'at least 3 letters',
    'word.valid': 'valid word ✓',
    'word.invalid': 'not a word',
    'history.title': 'Words played',
    'history.empty': 'No words yet — spell the first one!',
    'setup.tag': 'Spell words. Steal land. Storm the castle.',
    'setup.local': 'Local play',
    'setup.localDesc': 'Two players, one screen',
    'setup.bot': 'Vs bot',
    'setup.botDesc': 'Battle the machine',
    'setup.difficulty': 'Bot difficulty:',
    'setup.easiest': '1 · very easy',
    'setup.hardest': '10 · very hard',
    'setup.start': 'Start game',
    'setup.loading': 'Loading words…',
    'setup.retry': 'Failed to load words — tap to retry',
    'setup.back': '← Back to game',
    'howto.title': 'How to play',
    'howto.spellHead': '🔤 Spell words',
    'howto.spellBody': 'Tap any letter tiles on the board to make a valid word (3+ letters, one word per turn).',
    'howto.captureHead': '🚩 Capture tiles',
    'howto.captureBody': "You capture the chains of played letters that touch your territory. Blank tiles next to captured tiles are revealed. Opponent tiles next to captured tiles turn back into letter tiles. Played letters that don't reach your territory are re-rolled.",
    'howto.baseHead': '🏰 Go for the base',
    'howto.baseBody': "Destroy your opponent's base tile to earn an extra turn. If your opponent hasn't lost, their base reappears on a random tile of their territory after your extra turn.",
    'howto.winHead': '⚔️ Wipe out your opponent to win',
    'howto.winBody': 'Take their base and every last tile of their territory and the board is yours.',
    'howto.close': 'Got it',
    'over.title': 'Game over',
    'over.rematch': 'Rematch',
    'over.changeMode': 'Change mode',
    'player.you': 'You',
    'player.bot': (n) => `Bot (level ${n})`,
    'player.red': 'Red',
    'player.blue': 'Blue',
    'turn.yours': 'Your turn',
    'turn.botThinking': 'Bot is thinking…',
    'turn.red': "Red's turn",
    'turn.blue': "Blue's turn",
    'turn.wins': (name) => `${name} wins! 🏆`,
    'turn.youWin': 'You win! 🏆',
    'turn.botWins': 'The bot wins',
    'turn.draw': "It's a draw",
    'tile.hidden': 'Hidden tile',
    'tile.letter': (l) => `Letter ${l}`,
    'tile.territory': (name) => `${name} territory`,
    'tile.base': (name) => `${name} base`,
    'toast.noWordsYou': (name) => `${name} have no possible words — turn passed`,
    'toast.noWords': (name) => `${name} has no possible words — turn passed`,
    'toast.respawn': (name) => `🏰 ${name}'s base rose again on a new tile`,
    'toast.baseDown': (a, b) => `💥 ${a} destroyed ${b}'s base — extra turn!`,
    'toast.langLoading': (name) => `Loading ${name} words…`,
    'toast.langNewGame': (name) => `Switched to ${name} — a fresh board was dealt`,
    'toast.langFailed': (name) => `Could not load the ${name} word list`,
    'over.drawSub': 'Neither side could spell another word.',
    'over.youWinTitle': 'You win! 🏆',
    'over.botWinsTitle': 'The bot wins 🤖',
    'over.stalemateSub': (name) => `No words were left to play — ${name} held more territory.`,
    'over.youBeatBot': (n) => `You wiped out the level ${n} bot.`,
    'over.botBeatYou': 'Your base and territory were wiped out.',
    'over.wipedOut': (name) => `${name} was wiped off the board.`,

    // multiplayer
    'top.multiplayer': 'Multiplayer',
    'top.signIn': 'Sign In',
    'login.title': 'Multiplayer',
    'login.tag': 'Pick a name and a password. A new name creates an account on the spot.',
    'login.joinTag': 'Sign in to join this game.',
    'login.name': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.working': 'Signing in…',
    'login.cancel': 'Cancel',
    'login.errName': 'Use 2–20 letters, digits, _ or -',
    'login.errPassword': 'Enter a password',
    'login.errWrong': 'Wrong password for that name',
    'login.errNetwork': 'Could not reach the server — try again',
    'login.errCrypto': 'Sign-in needs a secure (https) page',
    'lobby.title': 'Multiplayer',
    'lobby.signedInAs': 'Signed in as',
    'lobby.signOut': 'Sign out',
    'lobby.players': 'Players online',
    'lobby.noPlayers': 'Nobody else is online right now. Keep this page open — challenges pop up wherever you are.',
    'lobby.challenge': 'Challenge',
    'lobby.waiting': 'Waiting…',
    'lobby.cancel': 'Cancel',
    'lobby.available': 'available',
    'lobby.inGame': 'in a game',
    'lobby.record': 'Your record',
    'lobby.noRecord': 'No games recorded yet — bot games count too while you are signed in.',
    'lobby.vsHumans': 'vs players',
    'lobby.vsBot': (n) => `vs bot level ${n}`,
    'lobby.vsName': (name) => `vs ${name}`,
    'lobby.recordLine': (w, l, d, i) => `${w} W · ${l} L · ${d} D · ${i} unfinished`,
    'lobby.recent': 'Recent games',
    'lobby.noGames': 'No games yet.',
    'lobby.open': 'open',
    'lobby.words': 'Most played words',
    'lobby.noWords': 'No words yet.',
    'lobby.close': 'Close',
    'result.win': 'won',
    'result.loss': 'lost',
    'result.draw': 'draw',
    'result.incomplete': 'unfinished',
    'opp.bot': (n) => `Bot (level ${n})`,
    'challenge.text': (name, lang) => `${name} challenges you · ${lang}`,
    'challenge.accept': 'Accept',
    'challenge.decline': 'Decline',
    'toast.signedIn': (name) => `Signed in as ${name}`,
    'toast.signedOut': 'Signed out',
    'toast.challengeSent': (name) => `Challenge sent to ${name}`,
    'toast.challengeDeclined': (name) => `${name} declined your challenge`,
    'toast.challengeExpired': (name) => `${name} didn't answer`,
    'toast.challengeFailed': 'Could not send the challenge — check your connection',
    'toast.roomMissing': 'That game does not exist',
    'toast.roomLoading': 'Joining game…',
    'toast.outOfSync': 'Out of sync with the server — board refreshed',
    'toast.moveFailed': 'Could not send your move — check your connection',
    'toast.spectating': 'You are watching this game',
    'turn.waiting': (name) => `Waiting for ${name}…`,
    'turn.of': (name) => `${name}'s turn`,
    'presence.online': 'online',
    'presence.offline': 'offline',
    'over.opponentWinsTitle': (name) => `${name} wins`,
    'over.youBeat': (name) => `You wiped out ${name}.`,
    'over.beatYou': (name) => `${name} wiped out your base and territory.`,
    'over.rematchSent': 'Rematch challenge sent — waiting for an answer…',
    'over.rematchNeedsOpponent': 'Your opponent is offline — challenge someone from the lobby',
    'setup.online': 'Online',
    'setup.onlineDesc': 'Challenge another player',
    'word.resign': 'Resign',
    'word.resignConfirm': 'Tap again to resign',
    'over.resigned': (name) => `${name} resigned.`,
    'over.youResigned': 'You resigned.',
    'toast.moveSlow': 'Still sending your move — check your connection',
    'toast.challengeGone': 'That challenge is no longer open',
    'toast.seated': 'You are seated — good luck!',
    'challenge.region': 'Challenges',
  },

  fr: {
    'lang.pick': 'Langue',
    'theme.toggle': 'Basculer le mode sombre',
    'top.help': 'Comment jouer',
    'top.newGame': 'Nouvelle partie',
    'word.prompt': 'Touchez des lettres pour former un mot',
    'word.clear': 'Effacer',
    'word.play': 'Jouer le mot',
    'word.tooShort': '3 lettres minimum',
    'word.valid': 'mot valide ✓',
    'word.invalid': 'mot inconnu',
    'history.title': 'Mots joués',
    'history.empty': 'Aucun mot pour l’instant — à vous de commencer !',
    'setup.tag': 'Formez des mots. Prenez du terrain. Prenez le château.',
    'setup.local': 'Deux joueurs',
    'setup.localDesc': 'À deux sur un écran',
    'setup.bot': 'Contre le bot',
    'setup.botDesc': 'Affrontez la machine',
    'setup.difficulty': 'Niveau du bot :',
    'setup.easiest': '1 · très facile',
    'setup.hardest': '10 · très difficile',
    'setup.start': 'Commencer',
    'setup.loading': 'Chargement des mots…',
    'setup.retry': 'Échec du chargement — touchez pour réessayer',
    'setup.back': '← Retour à la partie',
    'howto.title': 'Comment jouer',
    'howto.spellHead': '🔤 Formez des mots',
    'howto.spellBody': 'Touchez les tuiles-lettres du plateau pour former un mot valide (3 lettres minimum, un seul mot par tour).',
    'howto.captureHead': '🚩 Capturez des tuiles',
    'howto.captureBody': "Vous capturez les chaînes de lettres jouées qui touchent votre territoire. Les tuiles cachées voisines d'une tuile capturée sont révélées. Les tuiles adverses voisines redeviennent des tuiles-lettres. Les lettres jouées qui n'atteignent pas votre territoire sont retirées au sort.",
    'howto.baseHead': '🏰 Visez le château',
    'howto.baseBody': "Détruisez le château adverse pour gagner un tour supplémentaire. Si votre adversaire n'a pas perdu, son château réapparaît sur une tuile au hasard de son territoire après votre tour supplémentaire.",
    'howto.winHead': '⚔️ Éliminez votre adversaire pour gagner',
    'howto.winBody': 'Prenez son château et la moindre tuile de son territoire, et le plateau est à vous.',
    'howto.close': "C'est compris",
    'over.title': 'Partie terminée',
    'over.rematch': 'Revanche',
    'over.changeMode': 'Changer de mode',
    'player.you': 'Vous',
    'player.bot': (n) => `Bot (niveau ${n})`,
    'player.red': 'Rouge',
    'player.blue': 'Bleu',
    'turn.yours': 'À vous de jouer',
    'turn.botThinking': 'Le bot réfléchit…',
    'turn.red': 'Au tour de Rouge',
    'turn.blue': 'Au tour de Bleu',
    'turn.wins': (name) => `${name} gagne ! 🏆`,
    'turn.youWin': 'Vous gagnez ! 🏆',
    'turn.botWins': 'Le bot gagne',
    'turn.draw': 'Match nul',
    'tile.hidden': 'Tuile cachée',
    'tile.letter': (l) => `Lettre ${l}`,
    'tile.territory': (name) => `Territoire ${name}`,
    'tile.base': (name) => `Château ${name}`,
    'toast.noWordsYou': (name) => `${name} n'avez aucun mot possible — tour passé`,
    'toast.noWords': (name) => `${name} n'a aucun mot possible — tour passé`,
    'toast.respawn': (name) => `🏰 Le château de ${name} renaît sur une nouvelle tuile`,
    'toast.baseDown': (a, b) => `💥 ${a} a détruit le château de ${b} — tour supplémentaire !`,
    'toast.langLoading': (name) => `Chargement des mots (${name})…`,
    'toast.langNewGame': (name) => `Langue : ${name} — nouveau plateau distribué`,
    'toast.langFailed': (name) => `Impossible de charger la liste de mots (${name})`,
    'over.drawSub': 'Plus personne ne pouvait former de mot.',
    'over.youWinTitle': 'Vous gagnez ! 🏆',
    'over.botWinsTitle': 'Le bot gagne 🤖',
    'over.stalemateSub': (name) => `Plus aucun mot jouable — ${name} contrôlait le plus de terrain.`,
    'over.youBeatBot': (n) => `Vous avez éliminé le bot de niveau ${n}.`,
    'over.botBeatYou': 'Votre château et votre territoire ont été anéantis.',
    'over.wipedOut': (name) => `${name} a été rayé du plateau.`,

    // multijoueur
    'top.multiplayer': 'Multijoueur',
    'top.signIn': 'Se connecter',
    'login.title': 'Multijoueur',
    'login.tag': 'Choisissez un nom et un mot de passe. Un nouveau nom crée un compte immédiatement.',
    'login.joinTag': 'Connectez-vous pour rejoindre cette partie.',
    'login.name': 'Nom d’utilisateur',
    'login.password': 'Mot de passe',
    'login.submit': 'Se connecter',
    'login.working': 'Connexion…',
    'login.cancel': 'Annuler',
    'login.errName': '2 à 20 lettres, chiffres, _ ou -',
    'login.errPassword': 'Saisissez un mot de passe',
    'login.errWrong': 'Mot de passe incorrect pour ce nom',
    'login.errNetwork': 'Serveur injoignable — réessayez',
    'login.errCrypto': 'La connexion nécessite une page sécurisée (https)',
    'lobby.title': 'Multijoueur',
    'lobby.signedInAs': 'Connecté en tant que',
    'lobby.signOut': 'Se déconnecter',
    'lobby.players': 'Joueurs en ligne',
    'lobby.noPlayers': 'Personne d’autre n’est en ligne. Gardez cette page ouverte — les défis apparaissent où que vous soyez.',
    'lobby.challenge': 'Défier',
    'lobby.waiting': 'En attente…',
    'lobby.cancel': 'Annuler',
    'lobby.available': 'disponible',
    'lobby.inGame': 'en partie',
    'lobby.record': 'Votre bilan',
    'lobby.noRecord': 'Aucune partie enregistrée — les parties contre le bot comptent aussi quand vous êtes connecté.',
    'lobby.vsHumans': 'contre des joueurs',
    'lobby.vsBot': (n) => `contre le bot niveau ${n}`,
    'lobby.vsName': (name) => `contre ${name}`,
    'lobby.recordLine': (w, l, d, i) => `${w} V · ${l} D · ${d} N · ${i} inachevée${i > 1 ? 's' : ''}`,
    'lobby.recent': 'Parties récentes',
    'lobby.noGames': 'Aucune partie pour l’instant.',
    'lobby.open': 'ouvrir',
    'lobby.words': 'Mots les plus joués',
    'lobby.noWords': 'Aucun mot pour l’instant.',
    'lobby.close': 'Fermer',
    'result.win': 'gagnée',
    'result.loss': 'perdue',
    'result.draw': 'nulle',
    'result.incomplete': 'inachevée',
    'opp.bot': (n) => `Bot (niveau ${n})`,
    'challenge.text': (name, lang) => `${name} vous défie · ${lang}`,
    'challenge.accept': 'Accepter',
    'challenge.decline': 'Refuser',
    'toast.signedIn': (name) => `Connecté en tant que ${name}`,
    'toast.signedOut': 'Déconnecté',
    'toast.challengeSent': (name) => `Défi envoyé à ${name}`,
    'toast.challengeDeclined': (name) => `${name} a refusé votre défi`,
    'toast.challengeExpired': (name) => `${name} n’a pas répondu`,
    'toast.challengeFailed': 'Impossible d’envoyer le défi — vérifiez votre connexion',
    'toast.roomMissing': 'Cette partie n’existe pas',
    'toast.roomLoading': 'Connexion à la partie…',
    'toast.outOfSync': 'Désynchronisé du serveur — plateau actualisé',
    'toast.moveFailed': 'Impossible d’envoyer votre coup — vérifiez votre connexion',
    'toast.spectating': 'Vous regardez cette partie',
    'turn.waiting': (name) => `En attente de ${name}…`,
    'turn.of': (name) => `Au tour de ${name}`,
    'presence.online': 'en ligne',
    'presence.offline': 'hors ligne',
    'over.opponentWinsTitle': (name) => `${name} gagne`,
    'over.youBeat': (name) => `Vous avez éliminé ${name}.`,
    'over.beatYou': (name) => `${name} a anéanti votre château et votre territoire.`,
    'over.rematchSent': 'Défi de revanche envoyé — en attente de réponse…',
    'over.rematchNeedsOpponent': 'Votre adversaire est hors ligne — défiez quelqu’un depuis le salon',
    'setup.online': 'En ligne',
    'setup.onlineDesc': 'Défiez un autre joueur',
    'word.resign': 'Abandonner',
    'word.resignConfirm': 'Touchez encore pour abandonner',
    'over.resigned': (name) => `${name} a abandonné.`,
    'over.youResigned': 'Vous avez abandonné.',
    'toast.moveSlow': 'Envoi du coup en cours — vérifiez votre connexion',
    'toast.challengeGone': 'Ce défi n’est plus ouvert',
    'toast.seated': 'Vous êtes à la table — bonne chance !',
    'challenge.region': 'Défis',
  },

  it: {
    'lang.pick': 'Lingua',
    'theme.toggle': 'Attiva/disattiva la modalità scura',
    'top.help': 'Come si gioca',
    'top.newGame': 'Nuova partita',
    'word.prompt': 'Tocca le lettere per comporre una parola',
    'word.clear': 'Cancella',
    'word.play': 'Gioca la parola',
    'word.tooShort': 'almeno 3 lettere',
    'word.valid': 'parola valida ✓',
    'word.invalid': 'parola non valida',
    'history.title': 'Parole giocate',
    'history.empty': 'Ancora nessuna parola — comincia tu!',
    'setup.tag': 'Componi parole. Conquista terreno. Espugna il castello.',
    'setup.local': 'Due giocatori',
    'setup.localDesc': 'In due su un solo schermo',
    'setup.bot': 'Contro il bot',
    'setup.botDesc': 'Sfida la macchina',
    'setup.difficulty': 'Livello del bot:',
    'setup.easiest': '1 · molto facile',
    'setup.hardest': '10 · molto difficile',
    'setup.start': 'Inizia partita',
    'setup.loading': 'Caricamento parole…',
    'setup.retry': 'Caricamento fallito — tocca per riprovare',
    'setup.back': '← Torna alla partita',
    'howto.title': 'Come si gioca',
    'howto.spellHead': '🔤 Componi parole',
    'howto.spellBody': 'Tocca le tessere-lettera sul tabellone per formare una parola valida (almeno 3 lettere, una parola per turno).',
    'howto.captureHead': '🚩 Conquista le tessere',
    'howto.captureBody': 'Conquisti le catene di lettere giocate che toccano il tuo territorio. Le tessere nascoste accanto a quelle conquistate vengono scoperte. Le tessere avversarie accanto tornano a essere tessere-lettera. Le lettere giocate che non raggiungono il tuo territorio vengono riestratte.',
    'howto.baseHead': '🏰 Punta al castello',
    'howto.baseBody': "Distruggi il castello avversario per guadagnare un turno extra. Se l'avversario non ha perso, il suo castello ricompare su una tessera a caso del suo territorio dopo il tuo turno extra.",
    'howto.winHead': "⚔️ Elimina l'avversario per vincere",
    'howto.winBody': 'Prendi il suo castello e ogni singola tessera del suo territorio: il tabellone è tuo.',
    'howto.close': 'Ho capito',
    'over.title': 'Partita finita',
    'over.rematch': 'Rivincita',
    'over.changeMode': 'Cambia modalità',
    'player.you': 'Tu',
    'player.bot': (n) => `Bot (livello ${n})`,
    'player.red': 'Rosso',
    'player.blue': 'Blu',
    'turn.yours': 'Tocca a te',
    'turn.botThinking': 'Il bot sta pensando…',
    'turn.red': 'Turno di Rosso',
    'turn.blue': 'Turno di Blu',
    'turn.wins': (name) => `${name} vince! 🏆`,
    'turn.youWin': 'Hai vinto! 🏆',
    'turn.botWins': 'Vince il bot',
    'turn.draw': 'Pareggio',
    'tile.hidden': 'Tessera nascosta',
    'tile.letter': (l) => `Lettera ${l}`,
    'tile.territory': (name) => `Territorio ${name}`,
    'tile.base': (name) => `Castello ${name}`,
    'toast.noWordsYou': (name) => `${name} non hai parole possibili — turno passato`,
    'toast.noWords': (name) => `${name} non ha parole possibili — turno passato`,
    'toast.respawn': (name) => `🏰 Il castello di ${name} rinasce su una nuova tessera`,
    'toast.baseDown': (a, b) => `💥 ${a} ha distrutto il castello di ${b} — turno extra!`,
    'toast.langLoading': (name) => `Caricamento parole (${name})…`,
    'toast.langNewGame': (name) => `Lingua: ${name} — nuovo tabellone distribuito`,
    'toast.langFailed': (name) => `Impossibile caricare la lista di parole (${name})`,
    'over.drawSub': 'Nessuno dei due poteva più comporre parole.',
    'over.youWinTitle': 'Hai vinto! 🏆',
    'over.botWinsTitle': 'Vince il bot 🤖',
    'over.stalemateSub': (name) => `Non restavano parole giocabili — ${name} controllava più territorio.`,
    'over.youBeatBot': (n) => `Hai spazzato via il bot di livello ${n}.`,
    'over.botBeatYou': 'Il tuo castello e il tuo territorio sono stati spazzati via.',
    'over.wipedOut': (name) => `${name} è stato spazzato via dal tabellone.`,

    // multigiocatore
    'top.multiplayer': 'Multigiocatore',
    'top.signIn': 'Accedi',
    'login.title': 'Multigiocatore',
    'login.tag': 'Scegli un nome e una password. Un nome nuovo crea subito un account.',
    'login.joinTag': 'Accedi per unirti a questa partita.',
    'login.name': 'Nome utente',
    'login.password': 'Password',
    'login.submit': 'Accedi',
    'login.working': 'Accesso…',
    'login.cancel': 'Annulla',
    'login.errName': 'Da 2 a 20 lettere, cifre, _ o -',
    'login.errPassword': 'Inserisci una password',
    'login.errWrong': 'Password errata per questo nome',
    'login.errNetwork': 'Server non raggiungibile — riprova',
    'login.errCrypto': 'L’accesso richiede una pagina sicura (https)',
    'lobby.title': 'Multigiocatore',
    'lobby.signedInAs': 'Connesso come',
    'lobby.signOut': 'Esci',
    'lobby.players': 'Giocatori online',
    'lobby.noPlayers': 'Nessun altro è online al momento. Tieni aperta questa pagina — le sfide compaiono ovunque tu sia.',
    'lobby.challenge': 'Sfida',
    'lobby.waiting': 'In attesa…',
    'lobby.cancel': 'Annulla',
    'lobby.available': 'disponibile',
    'lobby.inGame': 'in partita',
    'lobby.record': 'Il tuo bilancio',
    'lobby.noRecord': 'Nessuna partita registrata — anche le partite contro il bot contano quando sei connesso.',
    'lobby.vsHumans': 'contro giocatori',
    'lobby.vsBot': (n) => `contro il bot livello ${n}`,
    'lobby.vsName': (name) => `contro ${name}`,
    'lobby.recordLine': (w, l, d, i) => `${w} V · ${l} S · ${d} P · ${i} incompiut${i === 1 ? 'a' : 'e'}`,
    'lobby.recent': 'Partite recenti',
    'lobby.noGames': 'Ancora nessuna partita.',
    'lobby.open': 'apri',
    'lobby.words': 'Parole più giocate',
    'lobby.noWords': 'Ancora nessuna parola.',
    'lobby.close': 'Chiudi',
    'result.win': 'vinta',
    'result.loss': 'persa',
    'result.draw': 'pari',
    'result.incomplete': 'incompiuta',
    'opp.bot': (n) => `Bot (livello ${n})`,
    'challenge.text': (name, lang) => `${name} ti sfida · ${lang}`,
    'challenge.accept': 'Accetta',
    'challenge.decline': 'Rifiuta',
    'toast.signedIn': (name) => `Connesso come ${name}`,
    'toast.signedOut': 'Disconnesso',
    'toast.challengeSent': (name) => `Sfida inviata a ${name}`,
    'toast.challengeDeclined': (name) => `${name} ha rifiutato la sfida`,
    'toast.challengeExpired': (name) => `${name} non ha risposto`,
    'toast.challengeFailed': 'Impossibile inviare la sfida — controlla la connessione',
    'toast.roomMissing': 'Questa partita non esiste',
    'toast.roomLoading': 'Ingresso nella partita…',
    'toast.outOfSync': 'Fuori sincrono con il server — tabellone aggiornato',
    'toast.moveFailed': 'Impossibile inviare la mossa — controlla la connessione',
    'toast.spectating': 'Stai guardando questa partita',
    'turn.waiting': (name) => `In attesa di ${name}…`,
    'turn.of': (name) => `Turno di ${name}`,
    'presence.online': 'online',
    'presence.offline': 'offline',
    'over.opponentWinsTitle': (name) => `${name} vince`,
    'over.youBeat': (name) => `Hai spazzato via ${name}.`,
    'over.beatYou': (name) => `${name} ha spazzato via il tuo castello e il tuo territorio.`,
    'over.rematchSent': 'Sfida di rivincita inviata — in attesa di risposta…',
    'over.rematchNeedsOpponent': 'Il tuo avversario è offline — sfida qualcuno dalla lobby',
    'setup.online': 'Online',
    'setup.onlineDesc': 'Sfida un altro giocatore',
    'word.resign': 'Abbandona',
    'word.resignConfirm': 'Tocca di nuovo per abbandonare',
    'over.resigned': (name) => `${name} ha abbandonato.`,
    'over.youResigned': 'Hai abbandonato.',
    'toast.moveSlow': 'Invio della mossa in corso — controlla la connessione',
    'toast.challengeGone': 'Questa sfida non è più aperta',
    'toast.seated': 'Sei al tavolo — buona fortuna!',
    'challenge.region': 'Sfide',
  },
};

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: FLAG_GB, words: 'words_en_Collins_Scrabble_Words_2019.txt', bag: BAG_EN },
  { code: 'fr', name: 'Français', flag: FLAG_FR, words: 'words_fr_ODS8.txt', bag: BAG_FR },
  { code: 'it', name: 'Italiano', flag: FLAG_IT, words: 'words_it_sigmasaur.txt', bag: BAG_IT },
];

export const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'capitals.lang';

let current = DEFAULT_LANG;

export const languageOf = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
export const currentLanguage = () => languageOf(current);
export const getLang = () => current;

// `persist: false` switches the language without touching the saved
// preference — an online room dictates its language for the duration of the
// game, but that should not become the player's default.
export function setLang(code, persist = true) {
  current = languageOf(code).code;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* private mode: the choice simply won't stick */
    }
  }
  document.documentElement.lang = current;
}

// The saved choice, else the first browser language we have a dictionary for.
export function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    /* ignore */
  }
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language || '']) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGUAGES.some((l) => l.code === code)) return code;
  }
  return DEFAULT_LANG;
}

export function t(key, ...args) {
  const table = STRINGS[current] || STRINGS[DEFAULT_LANG];
  const val = key in table ? table[key] : STRINGS[DEFAULT_LANG][key];
  if (val === undefined) return key;
  return typeof val === 'function' ? val(...args) : val;
}

// Translate every element carrying data-i18n. By default the key replaces the
// element's text; data-i18n-attr="aria-label,title" sets those attributes
// instead.
export function applyStaticStrings(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    const attrs = el.dataset.i18nAttr;
    if (attrs) {
      for (const a of attrs.split(',')) el.setAttribute(a.trim(), t(key));
    } else {
      el.textContent = t(key);
    }
  }
}
