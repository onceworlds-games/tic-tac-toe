// The rules of the game, pure: boards, lines, who has won, when a draw is certain. No window, no document.
// A game is its list of moves: cells in the order they were played. X always moves first, so move 0 is X's, move 1 is O's.

/** The boards: 3x3 and 4x4 need their whole width, 5x5 needs four in a row. */
export const BOARDS = { 3: { n: 3, k: 3 }, 4: { n: 4, k: 4 }, 5: { n: 5, k: 4 } };
export const MAX_CELLS = 25;

export function boardFor(size) {
  return BOARDS[size] ?? BOARDS[3];
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const windowCache = new Map();

/** Every run of `k` cells that would win: arrays of cell indices. */
export function windows(n, k) {
  const key = n * 100 + k;
  let list = windowCache.get(key);
  if (list) return list;
  list = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      for (const [dx, dy] of DIRS) {
        const ex = x + dx * (k - 1);
        const ey = y + dy * (k - 1);
        if (ex < 0 || ex >= n || ey < 0 || ey >= n) continue;
        const run = [];
        for (let i = 0; i < k; i++) run.push((y + dy * i) * n + (x + dx * i));
        list.push(run);
      }
    }
  }
  windowCache.set(key, list);
  return list;
}

export const markOfMove = (i) => (i % 2 === 0 ? 'x' : 'o');
export const other = (m) => (m === 'x' ? 'o' : 'x');

export function emptyCells(n) {
  return new Array(n * n).fill('');
}

/**
 * The winning runs through the stone just placed at `idx`: each is the whole unbroken line of that mark (so five in a row
 * on 5x5 shows all five), only those at least `k` long.
 */
export function winLines(cells, n, k, idx) {
  const m = cells[idx];
  if (!m) return [];
  const x0 = idx % n;
  const y0 = Math.floor(idx / n);
  const lines = [];
  for (const [dx, dy] of DIRS) {
    const run = [idx];
    for (let s = 1; ; s++) {
      const x = x0 + dx * s;
      const y = y0 + dy * s;
      if (x < 0 || x >= n || y < 0 || y >= n || cells[y * n + x] !== m) break;
      run.push(y * n + x);
    }
    for (let s = 1; ; s++) {
      const x = x0 - dx * s;
      const y = y0 - dy * s;
      if (x < 0 || x >= n || y < 0 || y >= n || cells[y * n + x] !== m) break;
      run.unshift(y * n + x);
    }
    if (run.length >= k) lines.push(run);
  }
  return lines;
}

/** The mark that has a winning line anywhere on the board, or '' (for tests and for boards that were set up by hand). */
export function winnerOf(cells, n, k) {
  for (const w of windows(n, k)) {
    const m = cells[w[0]];
    if (m && w.every((c) => cells[c] === m)) return m;
  }
  return '';
}

/**
 * True when nobody can make a line any more: every run is blocked by both marks, or needs more stones than its owner still gets to play.
 * `next` is the mark about to move.
 */
export function drawIsCertain(cells, n, k, next) {
  let empty = 0;
  for (const c of cells) if (!c) empty++;
  if (empty === 0) return true;
  const movesLeft = { [next]: Math.ceil(empty / 2), [other(next)]: Math.floor(empty / 2) };
  for (const w of windows(n, k)) {
    let x = 0;
    let o = 0;
    for (const c of w) {
      if (cells[c] === 'x') x++;
      else if (cells[c] === 'o') o++;
    }
    const free = k - x - o;
    if (o === 0 && free <= movesLeft.x) return false;
    if (x === 0 && free <= movesLeft.o) return false;
  }
  return true;
}

/**
 * Replays a game. `ok` is false when a move is off the board, on a taken cell, or after the game was already decided.
 * status: 'play' | 'won' | 'draw'. `lines` are the winning runs; `last` the cell played last (-1 at the start).
 */
export function resolve(n, k, moves) {
  const cells = emptyCells(n);
  const out = { ok: true, cells, next: 'x', status: 'play', winner: '', lines: [], last: -1, count: 0 };
  if (!Array.isArray(moves)) return { ...out, ok: false };
  for (let i = 0; i < moves.length; i++) {
    const c = moves[i];
    if (out.status !== 'play' || !Number.isInteger(c) || c < 0 || c >= n * n || cells[c]) return { ...out, ok: false };
    const m = markOfMove(i);
    cells[c] = m;
    out.last = c;
    out.count = i + 1;
    out.next = other(m);
    const lines = winLines(cells, n, k, c);
    if (lines.length) {
      out.status = 'won';
      out.winner = m;
      out.lines = lines;
    } else if (drawIsCertain(cells, n, k, out.next)) out.status = 'draw';
  }
  return out;
}

/** Legal cells now (none once the game is decided). */
export function legalMoves(n, k, moves) {
  const r = resolve(n, k, moves);
  if (!r.ok || r.status !== 'play') return [];
  const out = [];
  for (let i = 0; i < r.cells.length; i++) if (!r.cells[i]) out.push(i);
  return out;
}
