// A series on one screen with no room: two people on one device, a demo of two computers, or a game against the
// computer when the page runs outside Onceworlds. Same data and view as a room match, driven by tick().
import { boardFor } from './rules.js';
import { describe, newGame, play, undo as undoGame, markOf, seriesState } from './core.js';
import { thinkSeconds } from './ai.js';
import { createDriver } from './brain.js';
import { buildView } from './view.js';

/**
 * cfg: { mode: 'same' | 'demo' | 'computer', board: 3|4|5, games: 1|3|5|0, firstMark: 'x'|'o',
 *        a: { name, ai?: level, avatarId? }, b: { ... }, brain, beat (seconds between games), pace (think-time factor), onEvent(ev) }
 * events: { type: 'start' | 'move' | 'undo' | 'end' | 'series' | 'denied', ... }
 */
export function createLocal(cfg) {
  const { n, k } = boardFor(cfg.board);
  const mode = cfg.mode;
  const games = cfg.games ?? 0;
  const beat = cfg.beat ?? 3;
  const pace = cfg.pace ?? 1;
  const emit = (ev) => cfg.onEvent && cfg.onEvent(ev);
  const driver = createDriver(cfg.brain);
  const players = {
    a: { id: 'a', name: cfg.a.name, ai: cfg.a.ai || '', bot: !!cfg.a.ai, me: mode === 'same' || !cfg.a.ai, away: false, left: false, avatarId: cfg.a.avatarId ?? null },
    b: { id: 'b', name: cfg.b.name, ai: cfg.b.ai || '', bot: !!cfg.b.ai, me: mode === 'same' || !cfg.b.ai, away: false, left: false, avatarId: cfg.b.avatarId ?? null },
  };
  let log = '';
  let g = 0;
  let data = null;
  let phase = 'play';
  let until = 0; // seconds of the between-games beat left
  let clock = 0;
  let hintsLeft = 3;
  let counted = false;

  function begin() {
    g += 1;
    const aMark = markOf('a', g, cfg.firstMark === 'o' ? 'o' : 'x');
    data = newGame({ n, k, g, x: aMark === 'x' ? 'a' : 'b', o: aMark === 'o' ? 'a' : 'b' });
    phase = 'play';
    counted = false;
    driver.reset();
    emit({ type: 'start', g });
  }

  function endGame() {
    const r = describe(data);
    let ch = 'd';
    if (r.status === 'won') ch = r.winner === 'x' ? (data.x === 'a' ? 'a' : 'b') : data.o === 'a' ? 'a' : 'b';
    log += ch;
    counted = true;
    const st = seriesState(log, games);
    phase = 'between';
    until = beat;
    emit({ type: 'end', result: r, ch, state: st });
  }

  function turnSeat() {
    const r = describe(data);
    return r.next === 'x' ? data.x : data.o;
  }

  function move(cell, who) {
    if (!data || phase !== 'play') return false;
    const seat = turnSeat();
    if (who && who !== seat) return false;
    const next = play(data, seat, cell);
    if (!next) {
      emit({ type: 'denied' });
      return false;
    }
    data = next;
    emit({ type: 'move', cell, seat });
    if (describe(data).status !== 'play') endGame();
    return true;
  }

  function view() {
    const st = seriesState(log, games);
    let ph = phase;
    if (phase === 'between' && st.done && until <= 0) ph = 'results';
    return buildView({
      mode: mode === 'computer' ? 'computer' : mode,
      phase: ph,
      data,
      log,
      games,
      a: players.a,
      b: players.b,
      g,
      level: players.b.ai || players.a.ai || 'normal',
      timer: 0,
      timeLeft: null,
      hintsLeft,
      canUndo: mode === 'same' || mode === 'computer',
      canHint: mode === 'computer',
    });
  }

  const api = {
    players,
    get hintsLeft() {
      return hintsLeft;
    },
    useHint() {
      if (hintsLeft > 0) hintsLeft--;
    },
    view,
    move,
    undo() {
      if (!data || phase !== 'play') return false;
      const botSeats = Object.values(players).filter((p) => p.bot).map((p) => p.id);
      const next = undoGame(data, { botSeats, seat: botSeats.length ? (players.a.bot ? 'b' : 'a') : '' });
      if (!next) return false;
      data = next;
      driver.reset();
      emit({ type: 'undo' });
      return true;
    },
    /** Moves the clock: the computer's turn, the pause between games. dt in seconds. */
    tick(dt) {
      if (!data) return;
      clock += dt;
      if (phase === 'between') {
        until -= dt;
        if (until <= 0) {
          if (seriesState(log, games).done) {
            phase = 'results';
            emit({ type: 'series', state: seriesState(log, games) });
          } else begin();
        }
        return;
      }
      if (phase !== 'play') return;
      const seat = turnSeat();
      const p = players[seat];
      let spec = null;
      if (p && p.ai) {
        const r = describe(data);
        const empties = r.cells.filter((c) => !c).length;
        spec = {
          key: `${g}|${data.moves.join(',')}`,
          request: { cells: r.cells, n, k, mark: r.next, level: p.ai },
          delay: thinkSeconds(p.ai, empties) * 1000 * pace,
        };
      }
      const cell = driver.update(spec, clock * 1000);
      if (cell != null) move(cell, seat);
    },
    /** Starts the next game of an endless series right away, or a fresh series. */
    restart() {
      log = '';
      g = 0;
      begin();
    },
    finish() {
      phase = 'results';
      emit({ type: 'series', state: seriesState(log, games) });
    },
    start() {
      begin();
    },
    get done() {
      return phase === 'results';
    },
  };
  void counted;
  return api;
}
