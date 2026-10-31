// One game and one series, as plain data, shared by the host's rules, the local (same screen) mode and every page's drawing.
import { resolve, other, MAX_CELLS } from './rules.js';

export const LEVELS = ['easy', 'normal', 'unbeatable'];
export const LEVEL_NAMES = { easy: 'Easy', normal: 'Normal', unbeatable: 'Unbeatable' };

/** Series lengths by setting value: games to play (0: endless). */
export const SERIES_GAMES = [1, 3, 5, 0];

export const isLevel = (v) => LEVELS.includes(v);

/** a: the first seat, b: the second; 'd' is a drawn game. */
export function tally(log) {
  const t = { a: 0, b: 0, d: 0 };
  for (const ch of String(log)) if (ch === 'a' || ch === 'b' || ch === 'd') t[ch]++;
  return t;
}

/** Where a series stands. games: 1, 3, 5 or 0 (endless). `winner` once done: 'a', 'b' or 'd'. */
export function seriesState(log, games) {
  const t = tally(log);
  const played = t.a + t.b + t.d;
  const remaining = games > 0 ? Math.max(0, games - played) : Infinity;
  let done = false;
  if (games > 0) done = played >= games || t.a > t.b + remaining || t.b > t.a + remaining;
  const winner = done ? (t.a > t.b ? 'a' : t.b > t.a ? 'b' : 'd') : '';
  return { ...t, played, done, winner, games };
}

/** The mark seat `slot` ('a' | 'b') plays in game `g` (1-based): marks swap every game, so the starter alternates. */
export function markOf(slot, g, firstMark) {
  const aMark = g % 2 === 1 ? firstMark : other(firstMark);
  return slot === 'a' ? aMark : other(aMark);
}

/** A fresh game. x and o are the seat ids that play those marks. */
export function newGame({ n, k, g, x, o }) {
  return { n, k, g, x, o, moves: [], ff: '', dl: 0 };
}

/** What the game looks like now: the rules' resolve plus a forfeit. */
export function describe(game) {
  const r = resolve(game.n, game.k, game.moves);
  if (game.ff === 'x' || game.ff === 'o') return { ...r, status: 'forfeit', winner: other(game.ff), lines: [] };
  return r;
}

/** Why `seat` can't play `cell` now ('' when they can). */
export function whyNot(game, seat, cell) {
  if (!game || !Number.isInteger(cell)) return 'bad move';
  if (cell < 0 || cell >= game.n * game.n || game.n * game.n > MAX_CELLS) return 'off the board';
  const r = describe(game);
  if (!r.ok) return 'broken game';
  if (r.status !== 'play') return 'game over';
  const mover = r.next === 'x' ? game.x : game.o;
  if (mover !== seat) return 'not your turn';
  if (r.cells[cell]) return 'taken';
  return '';
}

/** The game after `seat` plays `cell`, or null when that isn't allowed. */
export function play(game, seat, cell) {
  if (whyNot(game, seat, cell)) return null;
  return { ...game, moves: [...game.moves, cell] };
}

/**
 * Takes moves back. With a computer opponent the player's last move goes with the reply to it; at a shared screen one move goes.
 * Returns the new game, or null when there is nothing of theirs to take back.
 */
export function undo(game, { botSeats = [], seat = '' } = {}) {
  const r = describe(game);
  if (!r.ok || r.status !== 'play' || game.moves.length === 0) return null;
  let moves = game.moves.slice();
  if (botSeats.length) {
    // Drop the computer's moves from the end, then the player's one.
    const markAt = (i) => (i % 2 === 0 ? game.x : game.o);
    while (moves.length && botSeats.includes(markAt(moves.length - 1))) moves.pop();
    if (!moves.length) return null;
    if (seat && markAt(moves.length - 1) !== seat) return null;
    moves.pop();
  } else moves.pop();
  return { ...game, moves };
}
