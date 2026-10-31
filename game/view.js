// What a screen needs to know, worked out the same way for every mode (a room match or the local game):
// the two players, the marks, whose turn it is, the score, how the game ended. Pure.
import { describe, seriesState } from './core.js';
import { other } from './rules.js';

/**
 * input: {
 *   mode: 'computer' | 'friend' | 'same' | 'demo',
 *   phase: 'wait' | 'play' | 'between' | 'results',
 *   data: game data or null, log, games, ff (seat id that left), fin (finished by the host),
 *   a, b: players { id, name, bot, me, away, left, avatarId },
 *   spectating, level, timer (seconds per turn, 0 off), timeLeft (seconds or null),
 *   hintsLeft, canUndoNow (the mode allows it), g (game number)
 * }
 */
export function buildView(input) {
  const { mode, phase, data, log = '', games = 0, ff = '', fin = false, a = null, b = null } = input;
  const state = seriesState(log, games);
  const game = data ? describe(data) : null;
  const byMark = { x: null, o: null };
  if (data && a && b) {
    byMark.x = data.x === a.id ? a : data.x === b.id ? b : null;
    byMark.o = data.o === a.id ? a : data.o === b.id ? b : null;
  }
  const playing = !!game && game.ok && game.status === 'play' && phase === 'play';
  const next = game && game.ok ? game.next : '';
  const turnP = playing && next ? byMark[next] : null;
  let myMark = '';
  if (data && a && b && !input.spectating) {
    if (byMark.x && byMark.x.me && !(byMark.o && byMark.o.me)) myMark = 'x';
    else if (byMark.o && byMark.o.me && !(byMark.x && byMark.x.me)) myMark = 'o';
  }
  const mine = !!turnP && !!turnP.me && !input.spectating;

  // how the game ended
  let result = null;
  if (game && game.ok && game.status !== 'play') {
    if (game.status === 'draw') result = { kind: 'draw', mark: '', winner: null, loser: null };
    else result = { kind: game.status, mark: game.winner, winner: byMark[game.winner], loser: byMark[other(game.winner)] };
  }

  // who won the series
  let champion = null; // a | b | 'draw'
  if (phase === 'results') {
    if (ff) champion = ff === (a && a.id) ? b : a;
    else if (state.a > state.b) champion = a;
    else if (state.b > state.a) champion = b;
    else champion = 'draw';
  }

  const left = input.timeLeft;
  return {
    mode,
    phase,
    n: data ? data.n : 3,
    k: data ? data.k : 3,
    g: input.g || (data ? data.g : 1),
    data,
    game,
    a,
    b,
    byMark,
    next,
    turnP,
    myMark,
    mine,
    spectating: !!input.spectating,
    state,
    games,
    fin,
    ff,
    result,
    champion,
    level: input.level || 'normal',
    timer: input.timer || 0,
    timeLeft: left == null ? null : left,
    hintsLeft: input.hintsLeft ?? 0,
    canMove: playing && mine,
    canUndo: !!input.canUndo && playing && data.moves.length > 0,
    canHint: !!input.canHint && playing && mine && (input.hintsLeft ?? 0) > 0,
    thinking: playing && !!turnP && !!turnP.bot,
  };
}

/** The line under the board, in a few words. */
export function statusText(v) {
  if (!v) return '';
  if (v.spectating) return 'Watching';
  if (v.phase === 'wait') return '';
  if (v.phase === 'between' || v.phase === 'results') return '';
  if (!v.turnP) return '';
  if (v.mode === 'same') return `${v.turnP.name}'s move`;
  if (v.mine) return 'Your move';
  if (v.turnP.bot) return `${v.turnP.name} thinking`;
  return `${v.turnP.name}'s move`;
}
