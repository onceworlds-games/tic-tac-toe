// The computer: three levels, pure. A position is a list of cells ('x', 'o' or ''); the search plays on typed arrays.
//   easy        takes a win half the time, blocks a third of the time, otherwise anywhere
//   normal      always takes a win and blocks a loss, otherwise a good move (two plies deep), now and then its second choice
//   unbeatable  3x3: perfect play, fastest win and slowest loss. 4x4 and 5x5: iterative-deepening alpha-beta on a line-count
//               heuristic inside a time budget; it never misses a win or a block.
import { windows, boardFor } from './rules.js';

const WIN = 100000;

const rngDefault = Math.random;

const sideOf = (m) => (m === 'x' ? 1 : 2);

const geometry = new Map();

function geometryFor(n, k) {
  const key = n * 100 + k;
  let g = geometry.get(key);
  if (g) return g;
  const wins = windows(n, k);
  const cellWins = Array.from({ length: n * n }, () => []);
  wins.forEach((w, i) => w.forEach((c) => cellWins[c].push(i)));
  const centre = (n - 1) / 2;
  const cen = new Float64Array(n * n);
  for (let c = 0; c < n * n; c++) cen[c] = -(Math.abs((c % n) - centre) + Math.abs(Math.floor(c / n) - centre)) * 0.01 + cellWins[c].length * 0.05;
  // How much a run is worth to whoever owns it, by stones held.
  const weight = new Float64Array(k + 1);
  for (let j = 1; j < k; j++) weight[j] = Math.pow(8, j - 1);
  g = { n, k, wins, cellWins, cen, weight };
  geometry.set(key, g);
  return g;
}

class Pos {
  constructor(cells, n, k) {
    this.g = geometryFor(n, k);
    this.n = n;
    this.k = k;
    this.b = new Int8Array(n * n);
    this.cx = new Int8Array(this.g.wins.length);
    this.co = new Int8Array(this.g.wins.length);
    this.empty = n * n;
    this.scratch = new Float64Array(n * n);
    this.eval = 0; // from X's side
    for (let i = 0; i < cells.length; i++) if (cells[i]) this.play(i, sideOf(cells[i]));
  }

  val(c, o) {
    if (c > 0 && o > 0) return 0;
    if (c > 0) return this.g.weight[c];
    if (o > 0) return -this.g.weight[o];
    return 0;
  }

  /** Puts a stone down; true when that completes a line. */
  play(cell, side) {
    const { cellWins } = this.g;
    const list = cellWins[cell];
    this.b[cell] = side;
    this.empty--;
    let won = false;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      this.eval -= this.val(this.cx[w], this.co[w]);
      if (side === 1) {
        this.cx[w]++;
        if (this.cx[w] === this.k) won = true;
      } else {
        this.co[w]++;
        if (this.co[w] === this.k) won = true;
      }
      this.eval += this.val(this.cx[w], this.co[w]);
    }
    return won;
  }

  undo(cell, side) {
    const list = this.g.cellWins[cell];
    this.b[cell] = 0;
    this.empty++;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      this.eval -= this.val(this.cx[w], this.co[w]);
      if (side === 1) this.cx[w]--;
      else this.co[w]--;
      this.eval += this.val(this.cx[w], this.co[w]);
    }
  }

  /** Would `side` complete a line by playing `cell`? */
  wins(cell, side) {
    const list = this.g.cellWins[cell];
    const mine = side === 1 ? this.cx : this.co;
    const theirs = side === 1 ? this.co : this.cx;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (theirs[w] === 0 && mine[w] === this.k - 1) return true;
    }
    return false;
  }

  /** How promising a cell is for ordering: wins first, then blocks, then runs it grows. */
  rank(cell, side) {
    const list = this.g.cellWins[cell];
    const mine = side === 1 ? this.cx : this.co;
    const theirs = side === 1 ? this.co : this.cx;
    let r = this.g.cen[cell];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (theirs[w] === 0) r += mine[w] === this.k - 1 ? 1e6 : this.g.weight[mine[w] + 1] * 0.5;
      if (mine[w] === 0) r += theirs[w] === this.k - 1 ? 1e5 : this.g.weight[theirs[w] + 1] * 0.4;
    }
    return r;
  }

  moves(side) {
    const out = [];
    for (let c = 0; c < this.b.length; c++) if (this.b[c] === 0) out.push(c);
    const r = this.scratch;
    for (let i = 0; i < out.length; i++) r[out[i]] = this.rank(out[i], side);
    // Insertion sort: the lists are short and this runs at every node.
    for (let i = 1; i < out.length; i++) {
      const c = out[i];
      const v = r[c];
      let j = i - 1;
      while (j >= 0 && r[out[j]] < v) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = c;
    }
    return out;
  }
}

function negamax(pos, depth, alpha, beta, side, ply, ctx) {
  if (pos.empty === 0) return 0;
  if (depth === 0) return side === 1 ? pos.eval : -pos.eval;
  if ((++ctx.nodes & 1023) === 0 && (ctx.now() > ctx.deadline || ctx.nodes > ctx.limit)) ctx.abort = true;
  if (ctx.abort) return 0;
  const moves = pos.moves(side);
  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const cell = moves[i];
    let v;
    if (pos.wins(cell, side)) v = WIN - ply;
    else {
      pos.play(cell, side);
      v = -negamax(pos, depth - 1, -beta, -alpha, 3 - side, ply + 1, ctx);
      pos.undo(cell, side);
    }
    if (ctx.abort) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function newCtx(budgetMs, now, nodeLimit) {
  const clock = now ?? Date.now;
  return { nodes: 0, abort: false, now: clock, deadline: clock() + budgetMs, limit: nodeLimit ?? Infinity };
}

/** Each legal move with its value for `side`, searched `depth` plies (exact values, no pruning at the top). */
function rootScores(pos, side, depth, ctx) {
  const out = [];
  for (const cell of pos.moves(side)) {
    let v;
    if (pos.wins(cell, side)) v = WIN;
    else {
      pos.play(cell, side);
      v = -negamax(pos, depth - 1, -Infinity, Infinity, 3 - side, 1, ctx);
      pos.undo(cell, side);
    }
    if (ctx.abort) return null;
    out.push({ cell, score: v });
  }
  return out;
}

/** The best moves by deepening: all moves tied for the top score. Falls back to the last full iteration when time runs out. */
function deepen(pos, side, maxDepth, ctx) {
  let result = null;
  let moves = pos.moves(side);
  for (let depth = 1; depth <= maxDepth; depth++) {
    let best = -Infinity;
    let tied = [];
    const scored = [];
    for (const cell of moves) {
      let v;
      if (pos.wins(cell, side)) v = WIN;
      else {
        pos.play(cell, side);
        // A window just under the best so far lets equal moves come back exact (so ties can be told apart).
        v = -negamax(pos, depth - 1, -Infinity, -(best - 1), 3 - side, 1, ctx);
        pos.undo(cell, side);
      }
      if (ctx.abort) break;
      scored.push({ cell, score: v });
      if (v > best) {
        best = v;
        tied = [cell];
      } else if (v === best) tied.push(cell);
    }
    if (ctx.abort) break;
    result = { cells: tied, score: best, depth };
    // Search the likeliest first next time.
    scored.sort((a, b) => b.score - a.score);
    moves = scored.map((s) => s.cell);
    if (Math.abs(best) > WIN / 2) break; // decided
  }
  return result;
}

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/**
 * The computer's move.
 * opts: { cells, n, k, mark: 'x'|'o' (who it plays), level: 'easy'|'normal'|'unbeatable', rng?, budgetMs?, now?, nodeLimit? }
 * Returns { cell, depth?, nodes } or null when the board is full.
 */
export function chooseMove(opts) {
  const { cells, n, k, mark, level = 'normal' } = opts;
  const rng = opts.rng ?? rngDefault;
  const side = sideOf(mark);
  const pos = new Pos(cells, n, k);
  if (pos.empty === 0) return null;
  const empties = [];
  for (let c = 0; c < n * n; c++) if (!cells[c]) empties.push(c);
  const winCells = empties.filter((c) => pos.wins(c, side));
  const blockCells = empties.filter((c) => pos.wins(c, 3 - side));

  if (level === 'easy') {
    if (winCells.length && rng() < 0.5) return { cell: pick(winCells, rng), nodes: 0 };
    if (blockCells.length && rng() < 1 / 3) return { cell: pick(blockCells, rng), nodes: 0 };
    return { cell: pick(empties, rng), nodes: 0 };
  }

  if (winCells.length) return { cell: pick(winCells, rng), nodes: 0 };
  if (blockCells.length) return { cell: pick(blockCells, rng), nodes: 0 };

  if (level === 'normal') {
    const ctx = newCtx(opts.budgetMs ?? 120, opts.now, opts.nodeLimit);
    let scored = rootScores(pos, side, 2, ctx);
    if (!scored) scored = empties.map((cell) => ({ cell, score: pos.rank(cell, side) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score === scored[0].score);
    const rest = scored.filter((s) => s.score < scored[0].score);
    // Now and then (about one move in four) its second choice.
    if (rng() < 0.25) {
      const second = rest.length ? rest.filter((s) => s.score === rest[0].score) : top.length > 1 ? top.slice(1) : top;
      return { cell: pick(second, rng).cell, nodes: ctx.nodes };
    }
    return { cell: pick(top, rng).cell, nodes: ctx.nodes };
  }

  // unbeatable
  if (empties.length === n * n) {
    // An empty big board: the middle is strong, any of the central cells will do.
    const mid = empties.slice().sort((a, b) => pos.g.cen[b] - pos.g.cen[a]);
    const best = mid.filter((c) => pos.g.cen[c] === pos.g.cen[mid[0]]);
    return { cell: pick(n === 3 ? empties : best, rng), nodes: 0 };
  }
  const perfect = n === 3;
  const ctx = newCtx(perfect ? 60000 : (opts.budgetMs ?? 300), opts.now, opts.nodeLimit);
  const found = deepen(pos, side, perfect ? empties.length : Math.min(empties.length, 14), ctx);
  if (!found) {
    // No time even for one ply: the best-looking cell.
    return { cell: pos.moves(side)[0], nodes: ctx.nodes };
  }
  return { cell: pick(found.cells, rng), depth: found.depth, nodes: ctx.nodes };
}

/** The strongest move for a hint: unbeatable's choice with no randomness among equals. */
export function hintMove(opts) {
  const r = chooseMove({ ...opts, level: 'unbeatable', rng: () => 0 });
  return r ? r.cell : -1;
}

/** How long the computer should seem to think, in seconds, for a human feel: longer when there is more to weigh. */
export function thinkSeconds(level, emptyCount, rng = rngDefault) {
  const base = level === 'easy' ? 0.4 : level === 'normal' ? 0.55 : 0.7;
  const extra = Math.min(0.5, emptyCount * 0.025);
  return Math.min(1.2, base + extra * rng() + 0.15 * rng());
}

export { boardFor };
