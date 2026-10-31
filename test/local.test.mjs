import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocal } from '../game/local.js';
import { chooseMove } from '../game/ai.js';
import { playLayout, stageLayout, cellAt, cellRect } from '../game/layout.js';
import { buildView, statusText } from '../game/view.js';
import { newGame, play } from '../game/core.js';

const brain = { choose: (req) => Promise.resolve(chooseMove({ ...req, nodeLimit: 8000 }).cell) };
const flush = () => new Promise((r) => setImmediate(r));

async function runToEnd(local, limit = 4000) {
  for (let i = 0; i < limit && !local.done; i++) {
    local.tick(0.25);
    await flush();
  }
}

test('two computers play whole series on every board, no exceptions, scores add up', async () => {
  for (const board of [3, 4, 5]) {
    for (const games of [1, 3, 5]) {
      const events = [];
      const l = createLocal({ mode: 'demo', board, games, firstMark: 'x', a: { name: 'A', ai: 'normal' }, b: { name: 'B', ai: 'easy' }, brain, beat: 0.5, pace: 0.2, onEvent: (e) => events.push(e) });
      l.start();
      await runToEnd(l);
      assert.ok(l.done, `${board}x${board} bo${games} finished`);
      const v = l.view();
      assert.equal(v.phase, 'results');
      assert.ok(v.state.done);
      assert.ok(v.state.played >= 1 && v.state.played <= games);
      assert.equal(events.filter((e) => e.type === 'end').length, v.state.played);
      for (const x of [v.state.a, v.state.b, v.state.d]) assert.ok(Number.isFinite(x));
    }
  }
});

test('same screen: both seats are people, turns alternate, undo takes one move, marks swap', () => {
  const l = createLocal({ mode: 'same', board: 3, games: 3, firstMark: 'x', a: { name: 'P1' }, b: { name: 'P2' }, brain, beat: 0.1 });
  l.start();
  let v = l.view();
  assert.equal(v.turnP.name, 'P1');
  assert.equal(statusText(v), "P1's move");
  assert.ok(l.move(4));
  assert.equal(l.view().turnP.name, 'P2');
  assert.equal(l.move(4), false);
  assert.ok(l.undo());
  assert.deepEqual(l.view().data.moves, []);
  // P1 wins the first game with the top row
  for (const c of [0, 3, 1, 4, 2]) assert.ok(l.move(c));
  v = l.view();
  assert.equal(v.phase, 'between');
  assert.equal(v.state.a, 1);
  l.tick(0.2);
  v = l.view();
  assert.equal(v.phase, 'play');
  assert.equal(v.g, 2);
  // game 2: P2 is X and starts
  assert.equal(v.turnP.name, 'P2');
  assert.equal(v.byMark.x.name, 'P2');
});

test('against the computer the human cannot play for it, and hints are limited', async () => {
  const l = createLocal({ mode: 'computer', board: 3, games: 1, firstMark: 'o', a: { name: 'Me' }, b: { name: 'Computer', ai: 'unbeatable' }, brain, beat: 0.1, pace: 0.1 });
  l.start();
  assert.equal(l.view().mine, false);
  assert.equal(l.move(0, 'a'), false); // computer opens as X
  for (let i = 0; i < 40 && l.view().data.moves.length === 0; i++) {
    l.tick(0.25);
    await flush();
  }
  const v = l.view();
  assert.equal(v.data.moves.length, 1);
  assert.equal(v.mine, true);
  assert.equal(v.hintsLeft, 3);
  l.useHint();
  l.useHint();
  l.useHint();
  l.useHint();
  assert.equal(l.hintsLeft, 0);
  assert.equal(l.view().canHint, false);
});

test('layout: the board is a square that fits, clear of the menu, in every window', () => {
  for (const [w, h] of [[390, 844], [844, 390], [1280, 720], [360, 640], [1920, 1080], [768, 1024]]) {
    const L = playLayout(w, h, null);
    const b = L.board;
    assert.ok(b.s >= 120, `${w}x${h} board ${b.s}`);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.s <= w + 1 && b.y + b.s <= h + 1, `${w}x${h} inside`);
    // nothing of ours in the menu's corner (130 x 56)
    for (const r of [L.score, L.status, L.actions]) assert.ok(r.x >= 130 || r.y >= 56, `${w}x${h} clear`);
    const overlap = (a, c) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
    assert.ok(!overlap({ ...b, w: b.s, h: b.s }, L.score), `${w}x${h} board/score`);
    assert.ok(!overlap({ ...b, w: b.s, h: b.s }, L.actions), `${w}x${h} board/actions`);
    const S = stageLayout(w, h, null, {});
    assert.ok(S.board.s >= 110);
  }
});

test('cells map to points and back', () => {
  const board = { x: 100, y: 50, s: 500 };
  for (const n of [3, 4, 5]) {
    for (let c = 0; c < n * n; c++) {
      const r = cellRect(board, n, c);
      assert.equal(cellAt(board, n, r.cx, r.cy), c);
    }
  }
  assert.equal(cellAt(board, 3, 10, 10), -1);
});

test('the view says who is who', () => {
  const a = { id: 'a', name: 'Ann', bot: false, me: true };
  const b = { id: 'b', name: 'Computer', bot: true, me: false };
  let data = newGame({ n: 3, k: 3, g: 1, x: 'a', o: 'b' });
  let v = buildView({ mode: 'computer', phase: 'play', data, log: '', games: 3, a, b, hintsLeft: 3, canUndo: true, canHint: true });
  assert.equal(v.myMark, 'x');
  assert.equal(v.mine, true);
  assert.equal(statusText(v), 'Your move');
  data = play(data, 'a', 4);
  v = buildView({ mode: 'computer', phase: 'play', data, log: '', games: 3, a, b });
  assert.equal(v.thinking, true);
  assert.equal(statusText(v), 'Computer thinking');
  v = buildView({ mode: 'computer', phase: 'play', data, log: '', games: 3, a, b, spectating: true });
  assert.equal(statusText(v), 'Watching');
  assert.equal(v.mine, false);
  v = buildView({ mode: 'friend', phase: 'results', data, log: 'aa', games: 3, a, b });
  assert.equal(v.champion, a);
  v = buildView({ mode: 'friend', phase: 'results', data, log: 'a', games: 3, ff: 'a', a, b });
  assert.equal(v.champion, b);
});
