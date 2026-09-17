# NimDuel

A mobile learning game for Nimiq Pay: quick arithmetic, flags, capitals and chess, with solo practice and private quiz rooms for 2–8 players.

[Play NimDuel](https://nimduel.212.43.158.253.sslip.io/)

## Current status

Players sign in by signing a wallet challenge and register a unique nickname. Solo practice and bot games are free. Human multiplayer games can be free or use entries of 1, 5 or 10 NIM on Mainnet.

For paid games, each participant adds **0.01 NIM** to the shared payout-fee reserve on top of their game entry. The prize pool is not reduced. The fee contribution is non-refundable; unused amounts remain in the reserve. No initial operator top-up is required. Payments are available only while the payment service is synchronized and can cover its obligations. Check Mainnet in Nimiq Pay before confirming a transfer. Historical Test NIM are maintained in a separate ledger. See [Payment details](docs/PAYMENTS.md).

Features include:

- Random arithmetic, 195 national flags, capitals for 194 countries, and a mixed quiz mode, each with three difficulty levels. South Africa is excluded from capitals.
- Chess against a friend or a bot: six bot levels, server-side Stockfish, color selection, training hints, takebacks and post-game replay.
- 30,000 Lichess chess puzzles, with three difficulty levels and mates in one to five moves.
- Quick matchmaking, rematches, ratings, mistake review, saved friends, presence and invitations. Room QR codes are generated locally.
- Free practice with feedback after every question.
- Invitations by link or room code, with quiz rooms for 2–8 players.
- Readiness confirmation tied to a fixed participant list.
- A shared 120-second start window and an individual 90-second quiz round, with up to 30 questions.
- Server-side answer validation, scores hidden until the match ends, and duplicate-request protection.
- Room recovery after a page reload, game history and answer review.
- Persistent SQLite game state, atomic room changes and cancellation of active matches after a server restart.
- Wallet connection through the official Mini App SDK and a separate signed login challenge. The server verifies the signature with `@nimiq/core`, derives the address from the public key and checks it against the selected address.
- Single-use login challenges valid for five minutes, bound to the app origin, session and wallet. Signing rotates the session; verified wallet sessions last 24 hours.
- Signing in with the same wallet restores its profile and history. One wallet session is active at a time. A new valid signature restores an active room and revokes the previous session while preserving any entry already paid.
- Six interface languages: English, Spanish, French, German, Portuguese and Ukrainian. A saved language choice takes priority over the Nimiq Pay language. Interface text, errors, rules, payments, signing messages and country names are localized.

## Running locally

Requires Node.js 24.14 or later. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

The frontend runs on port 5173 and the API on port 8787. Open the Network URL shown by Vite on a phone connected to the same Wi-Fi network. In Nimiq Pay, open the address as a Mini App and connect a wallet.

Connecting opens the native Nimiq Pay approval dialog and displays the selected address after approval. Confirm ownership by signing the one-time login message. Cancelling keeps the onboarding screen open: all games require a verified wallet and a nickname. Wallet connection and signed login have been confirmed on a physical phone.

The first verification associates any current guest history with the new wallet. Signing in to an existing wallet profile restores that profile's history; unrelated guest history is not merged. Sign out before switching wallets. Signing out during an active game is blocked to preserve access to the round.

```sh
npm test
npm run build
npm start
```

`npm start` serves the built `dist` directory and the API on one port. Locally, the server listens on `127.0.0.1`. For deployment, configure `HOST=0.0.0.0`, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your-domain` and a persistent `DATABASE_PATH`. Configure HTTPS, backups and payment storage before operating a public instance. See `.env.example`, `compose.yaml` and [Payment details](docs/PAYMENTS.md).

## Quiz rules

- Correct answer: +1 point. Incorrect answer: −1. Skip: 0.
- An ordinary room waits up to 30 minutes to fill. All seats must be occupied before players can confirm readiness. Matchmaking rooms use shorter lobby deadlines.
- Changing the participant list resets readiness. Once everyone is ready, the participant list is locked.
- Players must start within the 120-second start window. Starting later within that window does not shorten the player's individual 90-second round.
- Failing to start after confirming readiness counts as a forfeit.
- An open round sends a heartbeat every 1.5 seconds. If the last confirmed heartbeat is more than five seconds before the round deadline, an unfinished round is forfeited. Returning in time does not reset the timer.
- A player can finish early or answer all 30 questions. Once the result is submitted, closing the app does not remove it.
- The highest score among players who finish wins. Equal top scores share first place. If everyone forfeits, there is no winner.
- A server restart or a game-clock delay exceeding five seconds cancels active matches. Completed results are preserved.

## Payments

All human multiplayer games support free play or NIM entries, including quick and ranked matchmaking, invitations and group quizzes. Practice, puzzles and bot games remain free.

For a two-player game with a 1 NIM entry, each player sends **1.01 NIM** and the winner receives **2 NIM**. Tied leaders split the prize pool. Cancellation, server interruption or all players forfeiting returns each funded game entry. The separate 0.01 NIM contribution covers payout costs and is not refunded. Nimiq Pay may charge its own sending fee separately.

Extra, late or incorrect transfers associated with a payment intent are returned to the actual sender minus 0.01 NIM under the new fee rules. Amounts at or below that fee remain recorded as liabilities for manual resolution. Transfers without a recognized payment memo require manual reconciliation.

The server independently verifies deposits and maintains a PostgreSQL ledger with persistent payout jobs. A wallet response or client-supplied transaction hash never proves payment. Treasury keys stay outside the repository. This is a server-custodied prize pool, not a trustless escrow contract. Players' private keys are never sent to the game server.

## Implementation limits and verification

SQLite stores game rooms in one server process; Node.js marks its SQLite module as experimental. Financial accounting and recoverable payout jobs use PostgreSQL. Do not run multiple game-server processes against the same SQLite database: restarting one can cancel another process's matches.

The client polls over HTTP. Game state is stored on the server; local preferences are stored in the browser. The initial onboarding session uses an HttpOnly cookie lasting up to 30 days and does not grant game access. A signed wallet session lasts 24 hours, and gameplay requires a unique nickname. A signature proves control of an address; it does not prevent multiple wallets, bots or collusion.

Each player receives a separate question set. Arithmetic uses the same sequence of operations with different numbers. Equivalent difficulty and resistance to outside assistance have not been established; these remain limitations of competitive play.

Before the latest shared-fee change, the build, 167 automated tests and separate PostgreSQL checks for both networks passed. Browser scenarios covered all six languages at widths of 320, 375 and 768 pixels. The Testnet contribution, duel and prize flow was confirmed on two physical phones. The latest fee change was built and deployed; its automated test run was stopped at the owner's request. A complete native Mainnet contribution and payout flow has not yet been verified.

Further implementation notes and payment invariants are in [Development notes](docs/DEVELOPMENT.md) and [Release checks](docs/RELEASE-CHECK.md). These supporting documents are currently in Ukrainian.

## Geography

Flags cover 195 states: 193 UN members, Vatican City and Palestine. Capitals cover 194 states, with South Africa excluded. There are 196 city answers, accounting for Sucre/La Paz and Mbabane/Lobamba. South Africa's flag remains available. Dependent territories are not included.

Arithmetic, flags and capitals support practice, duels and groups. Geography rounds contain 30 distinct countries with four answer options each. Country names, city names, qualifications and answer review support all six languages. Changing the language does not restart a round.

SVG flags are stored in `public/flags`, with no external flag service required during gameplay. Original proportions are preserved, including Nepal and square flags. Afghanistan uses the republican tricolor supplied by the flag dataset; Syria uses the green, white and black flag with three red stars.

For countries with different capital functions, questions specify the city's role. Nauru uses its government district; Switzerland uses its federal city. Jerusalem and East Jerusalem carry disputed-status qualifications and are not used as distractors for one another. Indonesia asks for the seat of government, Jakarta. Equatorial Guinea uses Ciudad de la Paz. The catalogue was reviewed on September 8, 2026. These choices describe the bundled dataset and should be reviewed as facts change.

## Chess

Human chess duels can be free or use NIM entries. Training against NimBot is free. Chess rooms have exactly two participants; group quizzes support 2–8.

Each side has ten minutes with no increment. Human duel colors are assigned randomly. Before training, players can select white, black or random (`chessColor: w/b/random`, default `w`). The server assigns colors and the board faces the player. A white bot moves first. Rematches swap colors. After both players confirm readiness, they have 120 seconds to start. Chess clocks begin once both have started. One no-show forfeits; two no-shows produce no winner.

The server uses `chess.js` to validate check, checkmate, castling, en passant and promotion to queen, rook, bishop or knight. Threefold repetition and the fifty-move rule are applied automatically as rules of this mode. Stalemate, insufficient material, draw offers and confirmed resignation are supported. Move history is stored with the room.

The beginner bot selects random legal moves. The next five levels use Stockfish.js 19.0.0, lite single-threaded WASM, in a separate server process.

Difficulty, player-count and entry menus support keyboard selection, Escape, click-away dismissal and disabled options. The chessboard supports taps or arrow keys and Enter.

### Hints, replay and takebacks

A thinking indicator appears during the bot's turn. During training, a player can request a hint on their own turn. Server-side Stockfish at master strength suggests a legal move; the board highlights its origin and destination and shows a promotion piece where applicable. A hint neither plays the move nor pauses the clock.

Hints are cached for the current position. Repeating a request does not start another calculation; failed requests can be retried after ten seconds. Hints and bot moves share a bounded queue. The server prohibits hints in human games, discards stale responses and does not cancel a game when a hint fails.

Completed games offer first/previous/next/last navigation, move-list selection and the arrow, Home and End keys. Replay reconstructs positions through `chess.js`, including special moves. It is local and does not change moves, results or final clock values.

In unfinished bot training, takeback removes the player's last move and the bot's reply, if already received. If the bot is thinking, its stale reply is discarded. A white bot's opening move cannot be undone before the player has moved. Clocks do not restore spent time. The server rebuilds the position and all chess rights from history. A monotonic position revision rejects stale requests and engine responses, even when the same move is repeated. Takebacks are unavailable in completed or human games.

### Difficulty levels and engine limits

Quizzes and chess puzzles offer Easy, Normal and Hard. Their API values are `easy/normal/hard`; `normal` is retained for compatibility with saved rooms. The quiz host selects one shared level for the room.

- Arithmetic: Easy uses small numbers and multiplication up to 5 × 5; Normal uses the standard range; Hard uses two-digit numbers and larger products and divisions.
- Flags: Easy uses 40 familiar countries; Normal uses all 195; Hard uses all 195 with visually similar flags prioritized as distractors.
- Capitals: Easy uses 39 familiar countries and distractors from different regions; Normal uses all 194; Hard prioritizes capitals from the same region.
- Chess bot: Beginner, Easy, Normal, Hard, Expert and Master (`beginner/easy/normal/hard/expert/master`). After the random-move beginner, Stockfish Skill Levels are 0/5/12/17/20 with 100/200/450/800/1500 ms per move. These are engine settings, not promised Elo ratings. Human matchmaking normalizes chess difficulty to `normal`; bot strength does not affect other games. Rematches and statistics retain the selected level.

One Stockfish process handles requests sequentially with a 32 MiB hash and one computation thread. Up to 16 bot-training games can be active. HTTP handling and game clocks do not wait for engine search. Before applying a response, the server checks the room, position, move number, turn and legal moves. Queue and search time count against the bot's clock. Responses arriving after resignation, completion or restart are discarded. Engine failure cancels training without a loss or a weaker fallback bot.

The engine is not shipped to the browser. The server uses the unmodified `stockfish` 19.0.0 package and its `bin/stockfish-19-lite-single.js` and `.wasm` files.

## Friends, presence and room sharing

A verified wallet profile with a nickname can save a found player, invite them to a free or paid duel, or remove them. Friends are private, one-way bookmarks, with no friend requests or notifications to the saved player. The limit is 200, with no duplicates or self-additions. SQLite stores the list by stable profile ID, so signing in with the same wallet restores it.

`/api/friends` accepts GET and POST (`nickname` and `action: add/remove`). Ownership comes only from the verified session; the response exposes nicknames, not wallet addresses.

Friends display Online, Playing or Offline. A visible tab sends presence every 15 seconds; status expires after 45 seconds. The friend list refreshes every five seconds. The server determines Playing from an active round, including practice. Finishing a round returns the player to Online. Hidden tabs stop sending presence. Logout, session rotation and expiry remove online status. Wallet addresses, last-login times and other players' room codes are not disclosed. Presence does not control game time, forfeits or payments.

An ordinary invitation lobby shows a locally generated QR code for the same HTTPS link copied by the invite button. QR codes use a four-module quiet zone and black-on-white contrast. Matchmaking rooms, personal invitations and rematches remain restricted to their intended participants.

An invitation opens the room-entry screen; existing members return to their room. Scanning a code does not confirm readiness or transfer funds. A phone camera opens a normal web link; automatic opening in Nimiq Pay is not guaranteed.

## Sound

Short, quiet sounds accompany navigation, game starts and results, quiz and puzzle answers, chess moves, captures, check and takebacks. Web Audio synthesizes them without external files. There is no background music, timer ticking, typing sound or polling sound.

The sound toggle beside the language selector saves the choice in the browser. Sound stays silent before the first interaction and while the tab is hidden. Unsupported audio does not affect gameplay.

## License

Original NimDuel code is released under the [MIT License](LICENSE). Third-party components retain their own licenses, including the separate Stockfish server process under GPL-3.0 and the Lichess puzzle dataset under CC0.

License texts and notices are retained in `public/licenses/`, including `chess-js.txt`, `stockfish-gpl-3.0.txt` and `stockfish-NOTICE.txt`. Flag notices are in `public/flags/NOTICE.txt`. Capital names are maintained in the curated `shared/capitals.mjs` catalogue.
