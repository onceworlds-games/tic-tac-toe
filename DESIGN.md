# Tic Tac Toe: design

## What it is, what it isn't
Tic tac toe is the oldest game there is, so the difference is in the feel. Not a thin grid on a flat page: a heavy
lacquered board on a lit table, turned wooden pieces that drop in with a squash and a click, a strip of tape laid across the
win, and a scoreboard of split-flap tiles. Everything a player expects is here (computer at three levels, a friend online,
one screen, 3x3 / 4x4 / 5x5, series, undo, hints) and the rules are exact.

## Art direction
A walnut table under a desk lamp. A midnight-blue lacquered board with brass inlay for the lines and brass studs in the
corners. Chunky pieces: coral X (two crossed bars), gold O (a thick ring), each with a bevel, a highlight and a drop shadow
that tightens as it lands. The board's front edge glows in the colour of whoever is to move. Win: cream tape (the winner's
colour along both edges) is laid across the line while the other marks dim; a draw rattles the board.

Palette: walnut `#2e1a10` / lit `#4a2d1b`, lacquer `#182659` (`#2b4296` to `#0e1840`), coral `#ff5b4a`, gold `#ffc14a`,
cream `#f7eedb`, brass `#c79e45`.
Type: Archivo Black for display, Archivo 800 for labels.
Signature: the scoreboard is split-flap tiles that turn over (with a flip sound) when a score changes.
Shapes carry the meaning as well as colour: an X is always crossed bars, an O always a ring, and the mark chip on each
avatar is the same shape.

## Modes
- **Computer**: Easy / Normal / Unbeatable, pick X or O. A room match with the computer in a bot seat.
- **Same screen**: two people, "Player 1" and "Player 2", no room; offered only while alone, ends if a friend joins.
- **Friend**: a friends game (`private: true`, 2 seats). The host picks the settings and starts; the friend readies.
  If a friend is in the lobby the game is a friend game (the platform's strip has them ready up and the host start).
  A friend arriving during a game against the computer watches it.

Marks swap every game, so the starter alternates (X always moves first). The score is per player, with draws between.
Series: Single, Best of 3, Best of 5 (the series ends as soon as it can't change), Endless (the host taps Finish).
Default Best of 5 against the computer; choosing Friend sets Best of 3. A player who leaves forfeits the series.

## Computer
`game/ai.js`, pure.
- Easy: takes a win half the time, blocks a third of the time, otherwise anywhere.
- Normal: always wins or blocks when it can, else the best move two plies deep, its second choice one time in four.
- Unbeatable: 3x3 exhaustive negamax with alpha-beta (fastest win, slowest loss, ties broken at random). 4x4 / 5x5:
  iterative deepening alpha-beta on a line-count heuristic (every four-long run weighted by stones held) with move ordering,
  300 ms budget; it never misses an immediate win or block. Draws are also called early when no run can be completed.
The search runs in a worker built from `rules.js` and `ai.js` (a blob, since module workers aren't allowed); without a
worker it runs on the page. It thinks 0.4 to 1.2 s like a person, with a "thinking" line.

## Architecture
- `rules.js` boards, lines, wins, certain draws. `core.js` a game as plain data (`moves`), the series maths, undo.
- `online.js` the host's rules on the SDK helpers: `createMatch` (a series, one game per round, `over` ends it early),
  `createHost` (`move`, `undo`, `finish` rpcs with validation, series state under `host:`), `createBots` seats the computer,
  a driver plays its moves through the same rpc. Turn timer (friends only) in `onTick`: Off / 15 s / 30 s, a default move on time-out.
- `local.js` the same series on this page (same screen, inside the room's match; a computer game outside Onceworlds).
- `view.js` one view for every mode; `render.js` canvas; `ui.js`, `screens.js` DOM; `main.js` the glue.
- A page opened as `?poster=<name>` draws the store art; `?poster=ui-<screen>[-WxH]` shows a screen in a fixed state.

## First minute
The game joins as it loads: one setup screen (Computer is already chosen) with the platform's strip under it > Start > its one countdown > the first move. After a series the result stays up with the same strip under it; Setup goes back to the screen.
Hints only where they matter: "Your move".

## Tests
`npm test`: rules, every series length, the AI (the unbeatable level never loses 3x3 against every opponent sequence, as X
and as O; draws against itself; beats Easy and Normal), whole series between computers on every board, the online flow
through a fake room (start, alternate starters, undo, refused moves, a reload of the host, the host dropping, the friend leaving,
the turn timer, endless, late watchers). The online tests use the SDK helpers' built files (set `OW_SDK_DIST`) and skip
without them.
