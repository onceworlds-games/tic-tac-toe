// A series played in a room. The host's page runs the rules: it validates every move, applies it, scores the game and starts the next.
// Every page draws from the match record and the series state, so a reload or a new host carries on. The helpers (match, host,
// bots) are passed in so this module can run under node with a fake room.
import { boardFor, other } from './rules.js';
import { describe, newGame, play, undo as undoGame, whyNot, markOf, seriesState, SERIES_GAMES } from './core.js';
import { chooseMove, thinkSeconds } from './ai.js';
import { createDriver } from './brain.js';
import { buildView } from './view.js';

/** What the host picks, drawn by the game's own setup screen (lobby: 'game'). */
export const LOBBY_SETTINGS = [
  { id: 'opponent', label: 'Opponent', options: [{ value: 'computer', label: 'Computer' }, { value: 'friend', label: 'Friend' }], default: 'computer' },
  { id: 'board', label: 'Board', options: [{ value: 3, label: '3x3' }, { value: 4, label: '4x4' }, { value: 5, label: '5x5' }], default: 3 },
  { id: 'series', label: 'Series', options: [{ value: 1, label: 'Single' }, { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }, { value: 0, label: 'Endless' }], default: 5 },
  { id: 'level', label: 'Level', options: [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'unbeatable', label: 'Unbeatable' }], default: 'normal' },
  { id: 'mark', label: 'Your mark', options: [{ value: 'x', label: 'X' }, { value: 'o', label: 'O' }], default: 'x' },
  { id: 'timer', label: 'Turn timer', options: [{ value: 0, label: 'Off' }, { value: 15, label: '15 s' }, { value: 30, label: '30 s' }], default: 0 },
];

export const DEFAULTS = { opponent: 'computer', board: 3, series: 5, level: 'normal', mark: 'x', timer: 0 };

const isBotId = (id) => typeof id === 'string' && id.startsWith('bot:');

export function createOnline(room, h, opts = {}) {
  const T = h.t;
  const now = opts.now || (() => Date.now());
  const host = h.createHost(room);

  const series = host.state('series', {
    schema: { a: T.string(128), b: T.string(128), log: T.string(700), ff: T.string(128), fin: T.boolean() },
    initial: { a: '', b: '', log: '', ff: '', fin: false },
  });

  const dataSchema = {
    n: T.int(3, 5),
    k: T.int(3, 4),
    g: T.int(1, 100000),
    x: T.string(128),
    o: T.string(128),
    moves: T.array(T.int(0, 24), 25),
    ff: T.oneOf('', 'x', 'o'),
    dl: T.int(0, 1e9),
  };

  const settings = () => room.settings || {};
  const num = (id) => {
    const v = Number(settings()[id]);
    return Number.isFinite(v) ? v : DEFAULTS[id];
  };
  // Two people in the match is a game between friends, whatever the lobby said (a friend who is in the lobby has to ready for the host to start).
  const opponent = () => {
    if (room.match.phase !== 'lobby' && (room.match.participants || []).length >= 2) return 'friend';
    return settings().opponent === 'friend' ? 'friend' : 'computer';
  };
  const gamesSetting = () => (SERIES_GAMES.includes(num('series')) ? num('series') : 5);
  const timerSecs = () => (opponent() === 'friend' ? [0, 15, 30].find((v) => v === num('timer')) ?? 0 : 0);

  // ---------------------------------------------------------------- the rules (host)

  /** The deadline for the mover, when a person has to answer within a time. */
  function stamp(d) {
    const r = describe(d);
    const secs = timerSecs();
    const mover = r.next === 'x' ? d.x : d.o;
    d.dl = r.status === 'play' && secs > 0 && !isBotId(mover) ? Math.round(room.matchNow() + secs * 1000) : 0;
    return d;
  }

  function finishGame(d, r) {
    const S = series.get();
    let ch = 'd';
    let outcome = {};
    if (r.status === 'won') {
      const seat = r.winner === 'x' ? d.x : d.o;
      ch = seat === S.a ? 'a' : seat === S.b ? 'b' : 'd';
      if (ch !== 'd') outcome = { [seat]: 1 };
    }
    series.update((s) => {
      s.log = (s.log + ch).slice(-600);
    });
    match.endRound(outcome);
  }

  function applyMove(seatId, cell) {
    if (match.phase !== 'round') return false;
    const cur = match.data;
    if (!cur) return false;
    const next = play(cur, seatId, cell);
    if (!next) return false;
    stamp(next);
    match.setData(next);
    const r = describe(next);
    if (r.status !== 'play') finishGame(next, r);
    return true;
  }

  const moveCall = host.rpc('move', {
    args: { cell: T.int(0, 24) },
    rate: 5,
    validate: (from, a) => {
      if (match.phase !== 'round' || !match.data) return 'not now';
      return whyNot(match.data, from.id, a.cell) || true;
    },
    run: (from, a) => void applyMove(from.id, a.cell),
  });

  const undoCall = host.rpc('undo', {
    rate: 3,
    validate: (from) => {
      if (opponent() !== 'computer' || match.phase !== 'round' || !match.data) return 'not now';
      const S = series.get();
      if (from.id !== S.a && from.id !== S.b) return 'not a player';
      return true;
    },
    run: (from) => {
      const botSeats = match.seats.filter((s) => s.bot).map((s) => s.id);
      const next = undoGame(match.data, { botSeats, seat: from.id });
      if (next) match.setData(stamp(next));
    },
  });

  const finishCall = host.rpc('finish', {
    rate: 2,
    validate: (from) => (from.id === room.host && (match.phase === 'round' || match.phase === 'roundEnd') ? true : 'not now'),
    run: () => {
      series.update((s) => {
        s.fin = true;
      });
      // A game still being played is dropped; one that has just ended is already counted.
      const d = match.data;
      if (match.phase === 'round' && d && describe(d).status === 'play') match.endRound({});
    },
  });

  function timeoutMove(d, r) {
    const mover = r.next === 'x' ? d.x : d.o;
    const pick = chooseMove({ cells: r.cells, n: d.n, k: d.k, mark: r.next, level: 'normal', budgetMs: 40 });
    if (pick && applyMove(mover, pick.cell)) return;
    // Nothing found: the first free cell.
    const free = r.cells.findIndex((c) => !c);
    if (free >= 0) applyMove(mover, free);
  }

  function checkForfeit(m, d) {
    const S = series.get();
    if (S.ff || S.fin) return;
    const gone = [S.a, S.b].find((id) => id && !isBotId(id) && m.seats.some((s) => s.id === id && s.left));
    if (!gone) return;
    const winner = gone === S.a ? S.b : S.a;
    series.update((s) => {
      s.ff = gone;
    });
    match.setData({ ...d, ff: gone === d.x ? 'x' : 'o', dl: 0 });
    match.endRound(winner ? { [winner]: 1 } : {});
  }

  const match = h.createMatch(room, {
    rounds: 'series',
    maxRounds: 500,
    roundEndSeconds: 3,
    resultsSeconds: 0,
    tick: 100,
    data: dataSchema,
    startRound(m) {
      if (m.round === 1) {
        const [A, B] = m.seats;
        series.set({ a: A ? A.id : '', b: B ? B.id : '', log: '', ff: '', fin: false });
      }
      const S = series.get();
      const { n, k } = boardFor(num('board'));
      const firstMark = opponent() === 'computer' && settings().mark === 'o' ? 'o' : 'x';
      const aMark = markOf('a', m.round, firstMark);
      return stamp(newGame({ n, k, g: m.round, x: aMark === 'x' ? S.a : S.b, o: aMark === 'o' ? S.a : S.b }));
    },
    onTick(m) {
      const d = m.data;
      if (!d) return;
      checkForfeit(m, d);
      const r = describe(d);
      if (!r.ok || r.status !== 'play') return;
      const S = series.get();
      if (S.fin && d.moves.length === 0) return m.endRound({});
      if (d.dl > 0 && room.matchNow() >= d.dl) timeoutMove(d, r);
    },
    score: () => ({}),
    over: () => {
      const S = series.get();
      return S.fin || !!S.ff || seriesState(S.log, gamesSetting()).done;
    },
    final: () => {
      const S = series.get();
      if (S.ff) return [[S.ff === S.a ? S.b : S.a], [S.ff]];
      const st = seriesState(S.log, 0);
      if (st.a > st.b) return [[S.a], [S.b]];
      if (st.b > st.a) return [[S.b], [S.a]];
      return [[S.a, S.b].filter(Boolean)];
    },
  });

  // ---------------------------------------------------------------- the computer (host)

  const fillFor = () => (opponent() === 'friend' ? 1 : 2);
  const bots = h.createBots(match, { host, fill: fillFor(), names: ['Computer'], every: 5000, think: () => null });
  const driver = createDriver(opts.brain);

  function botTick() {
    try {
      bots.setFill(fillFor());
      const d = match.data;
      let spec = null;
      if (match.isHost && match.phase === 'round' && !match.paused && d) {
        const r = describe(d);
        if (r.ok && r.status === 'play') {
          const seatId = r.next === 'x' ? d.x : d.o;
          const seat = match.seats.find((s) => s.id === seatId);
          if (seat && seat.bot) {
            const level = ['easy', 'normal', 'unbeatable'].includes(settings().level) ? settings().level : 'normal';
            const empties = r.cells.filter((c) => !c).length;
            spec = {
              key: `${match.roundId}|${d.moves.join(',')}`,
              request: { cells: r.cells, n: d.n, k: d.k, mark: r.next, level },
              delay: thinkSeconds(level, empties) * 1000,
              seat,
            };
          }
        }
      }
      const cell = driver.update(spec, now());
      if (cell != null && spec) host.callAs({ id: spec.seat.id, name: spec.seat.name }, 'move', { cell });
    } catch (e) {
      console.error('[tic-tac-toe] computer turn failed', e);
    }
  }
  const timer = setInterval(botTick, 80);

  // ---------------------------------------------------------------- what pages draw

  function playerOf(id, fallbackIndex) {
    const seats = match.seats;
    const s = id ? seats.find((x) => x.id === id) : seats[fallbackIndex];
    if (!s) return id ? { id, name: 'Player', bot: false, me: false, away: false, left: true, avatarId: id } : null;
    return { id: s.id, name: s.name, bot: s.bot, me: s.me, away: s.away, left: s.left, avatarId: s.bot ? null : s.id };
  }

  /** extras: { hintsLeft } */
  function view(extras = {}) {
    const S = series.get();
    const mp = match.phase;
    const d = match.data;
    let phase = 'wait';
    if (mp === 'results') phase = 'results';
    else if (mp === 'roundEnd') phase = 'between';
    else if (mp === 'round' && d) phase = describe(d).status === 'play' ? 'play' : 'between';
    const left = d && d.dl > 0 && phase === 'play' ? Math.max(0, (d.dl - room.matchNow()) / 1000) : null;
    const comp = opponent() === 'computer';
    const a = playerOf(S.a, 0);
    const b = playerOf(S.b, 1);
    return buildView({
      mode: opponent(),
      phase,
      data: d && d.moves ? d : null,
      log: S.log,
      games: gamesSetting(),
      ff: S.ff,
      fin: S.fin,
      a,
      b,
      g: match.round,
      spectating: match.spectating,
      level: settings().level,
      timer: timerSecs(),
      timeLeft: left,
      hintsLeft: extras.hintsLeft ?? 0,
      canUndo: comp && !!a && a.me,
      canHint: comp,
    });
  }

  return {
    match,
    host,
    bots,
    series,
    view,
    move: (cell) => moveCall({ cell }),
    undo: () => undoCall({}),
    finish: () => finishCall({}),
    dispose() {
      clearInterval(timer);
      bots.dispose();
      match.dispose();
      host.dispose();
    },
  };
}

export { other };
