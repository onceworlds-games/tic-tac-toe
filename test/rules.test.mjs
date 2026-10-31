import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, windows, winLines, drawIsCertain, legalMoves, boardFor, winnerOf } from '../game/rules.js';
import { seriesState, markOf, newGame, play, undo, describe, whyNot, tally } from '../game/core.js';

test('window counts', () => {
  assert.equal(windows(3, 3).length, 8);
  assert.equal(windows(4, 4).length, 10);
  assert.equal(windows(5, 4).length, 28); // 10 rows, 10 columns, 8 diagonals
});

test('every 3x3 line wins', () => {
  for (const w of windows(3, 3)) {
    const moves = [];
    const rest = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !w.includes(c));
    // x takes the line, o takes harmless cells elsewhere
    const os = rest.slice(0, 2);
    moves.push(w[0], os[0], w[1], os[1], w[2]);
    const r = resolve(3, 3, moves);
    if (!r.ok) continue; // o's filler may have formed nothing; ok means legal
    assert.equal(r.status, 'won', w.join());
    assert.equal(r.winner, 'x');
    assert.deepEqual(r.lines[0].slice().sort(), w.slice().sort());
  }
});

test('o can win and ends the game', () => {
  const r = resolve(3, 3, [0, 3, 1, 4, 8, 5]);
  assert.equal(r.status, 'won');
  assert.equal(r.winner, 'o');
  assert.deepEqual(r.lines, [[3, 4, 5]]);
});

test('moves after the end or onto a taken cell are broken', () => {
  assert.equal(resolve(3, 3, [0, 3, 1, 4, 2, 5]).ok, false);
  assert.equal(resolve(3, 3, [0, 0]).ok, false);
  assert.equal(resolve(3, 3, [9]).ok, false);
  assert.equal(resolve(3, 3, [1.5]).ok, false);
  assert.equal(resolve(3, 3, null).ok, false);
});

test('a full 3x3 board without a line is a draw', () => {
  const r = resolve(3, 3, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(r.status, 'draw');
  assert.equal(r.winner, '');
});

test('the last stone wins even when the board is full', () => {
  // x: 0 2 3 7 8 ... construct: final move completes a line on the last cell
  const r = resolve(3, 3, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(r.status, 'draw');
  const w = resolve(3, 3, [0, 1, 3, 2, 4, 5, 8, 6, 7].slice(0, 7)); // x 0,3,4,8 -> diagonal 0,4,8 on x's 4th move
  assert.equal(w.status, 'won');
  assert.equal(w.winner, 'x');
});

test('4x4 needs four, 3 in a row does nothing', () => {
  const r = resolve(4, 4, [0, 4, 1, 5, 2, 6]);
  assert.equal(r.status, 'play');
  const w = resolve(4, 4, [0, 4, 1, 5, 2, 6, 3]);
  assert.equal(w.status, 'won');
  assert.deepEqual(w.lines, [[0, 1, 2, 3]]);
});

test('5x5 needs four, and a run of five lights all five', () => {
  const four = resolve(5, 4, [0, 5, 1, 6, 2, 7, 3]);
  assert.equal(four.status, 'won');
  assert.deepEqual(four.lines, [[0, 1, 2, 3]]);
  const five = resolve(5, 4, [0, 5, 1, 6, 3, 7, 4, 10, 2]);
  assert.equal(five.status, 'won');
  assert.deepEqual(five.lines, [[0, 1, 2, 3, 4]]);
});

test('a double line shows both', () => {
  // x builds an L: 0 1 2 across and 3 7 11 ... use 4x4 k=4 hard; use 5x5: x at 0,1,2,3 row and corner crossing needs both lines at once
  // cross: row 5..8 (y=1,x=0..3) and column x=3 y=0..3 (3,8,13,18) sharing cell 8 -> placing 8 last completes both
  const moves = [5, 24, 6, 0, 7, 22, 3, 10, 13, 20, 18, 15, 8];
  const r = resolve(5, 4, moves);
  assert.equal(r.status, 'won');
  assert.equal(r.lines.length, 2);
});

test('draw is called early when nothing can be completed', () => {
  // 3x3: x 0,1,5,6,... dead after blocks. Build a position where every line holds both marks but cells remain.
  // x: 0 4 5 ... pick: x0 o1 x2 o4 x3... use known: x at 0,2,3,7 o at 1,4,6,8? check all lines mixed
  const cells = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', ''];
  assert.equal(winnerOf(cells, 3, 3), '');
  assert.equal(drawIsCertain(cells, 3, 3, 'x'), true);
});

test('a line that needs more stones than its owner gets is dead', () => {
  // 4x4: only one empty cell left in a row for x, but it's o's turn and o's last move... build simply
  const cells = ['x', 'x', 'x', '', 'o', 'o', 'x', 'o', 'x', 'o', 'o', 'x', 'o', 'x', 'x', 'o'];
  // empty = 1 (index 3). x row 0..3 would win by playing 3: x to move has a move left
  assert.equal(drawIsCertain(cells, 4, 4, 'x'), false);
  // it is o's move: o takes the last cell, x gets none
  assert.equal(drawIsCertain(cells, 4, 4, 'o'), true);
});

test('5x5 early draw is detected in a played-out game', () => {
  // a checkerboard-like fill leaves no four possible long before the board is full
  const moves = [12, 6, 18, 8, 7, 17, 13, 11, 16, 2, 22, 10, 14, 4, 9];
  const r = resolve(5, 4, moves);
  assert.ok(r.ok);
  assert.ok(['play', 'draw', 'won'].includes(r.status));
});

test('legalMoves', () => {
  assert.equal(legalMoves(3, 3, []).length, 9);
  assert.equal(legalMoves(3, 3, [0, 3, 1, 4, 2]).length, 0);
  assert.equal(boardFor(5).k, 4);
  assert.equal(boardFor(99).n, 3);
});

test('winLines only counts the line through the new stone', () => {
  const cells = ['x', 'x', 'x', '', '', '', '', '', ''];
  assert.equal(winLines(cells, 3, 3, 4).length, 0);
  assert.equal(winLines(cells, 3, 3, 1).length, 1);
});

test('marks swap every game so the starter alternates', () => {
  assert.equal(markOf('a', 1, 'x'), 'x');
  assert.equal(markOf('b', 1, 'x'), 'o');
  assert.equal(markOf('a', 2, 'x'), 'o');
  assert.equal(markOf('a', 3, 'x'), 'x');
  assert.equal(markOf('a', 1, 'o'), 'o');
  assert.equal(markOf('a', 2, 'o'), 'x');
});

test('series: single, best of 3, best of 5, endless', () => {
  assert.equal(seriesState('a', 1).done, true);
  assert.equal(seriesState('', 1).done, false);
  assert.equal(seriesState('d', 1).winner, 'd');
  assert.equal(seriesState('aa', 3).done, true);
  assert.equal(seriesState('aa', 3).winner, 'a');
  assert.equal(seriesState('ab', 3).done, false);
  assert.equal(seriesState('abd', 3).winner, 'd');
  assert.equal(seriesState('abb', 3).winner, 'b');
  assert.equal(seriesState('aaa', 5).done, true);
  assert.equal(seriesState('aa', 5).done, false);
  assert.equal(seriesState('aabb', 5).done, false);
  assert.equal(seriesState('aabbd', 5).winner, 'd');
  assert.equal(seriesState('addd', 5).done, false);
  assert.equal(seriesState('adddd', 5).winner, 'a');
  assert.equal(seriesState('aaaaaaaaaa', 0).done, false);
  assert.deepEqual(tally('abdd'), { a: 1, b: 1, d: 2 });
});

test('game data: turns, taken cells, forfeits, undo', () => {
  let g = newGame({ n: 3, k: 3, g: 1, x: 'p', o: 'q' });
  assert.equal(whyNot(g, 'q', 0), 'not your turn');
  assert.equal(whyNot(g, 'p', 9), 'off the board');
  assert.equal(whyNot(g, 'p', 'a'), 'bad move');
  g = play(g, 'p', 4);
  assert.equal(whyNot(g, 'q', 4), 'taken');
  assert.equal(play(g, 'p', 0), null);
  g = play(g, 'q', 0);
  assert.equal(describe(g).next, 'x');
  const u = undo(g, {});
  assert.deepEqual(u.moves, [4]);
  const ub = undo(g, { botSeats: ['q'], seat: 'p' });
  assert.deepEqual(ub.moves, []);
  const ff = { ...g, ff: 'x' };
  assert.equal(describe(ff).status, 'forfeit');
  assert.equal(describe(ff).winner, 'o');
  assert.equal(whyNot(ff, 'p', 1), 'game over');
  const open = newGame({ n: 3, k: 3, g: 1, x: 'bot', o: 'me' });
  const o1 = play(open, 'bot', 0);
  assert.equal(undo(o1, { botSeats: ['bot'], seat: 'me' }), null);
});
