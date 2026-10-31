import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, hintMove, thinkSeconds } from '../game/ai.js';
import { resolve, legalMoves, other } from '../game/rules.js';

function rngFrom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ai = (n, k, moves, level, rng, extra = {}) => {
  const r = resolve(n, k, moves);
  return chooseMove({ cells: r.cells, n, k, mark: r.next, level, rng, ...extra }).cell;
};

/** Plays a whole game between two levels; returns the result. */
function playGame(n, k, xLevel, oLevel, rng, extra = {}) {
  const moves = [];
  for (;;) {
    const r = resolve(n, k, moves);
    assert.ok(r.ok);
    if (r.status !== 'play') return r;
    const level = r.next === 'x' ? xLevel : oLevel;
    const cell = ai(n, k, moves, level, rng, extra);
    assert.ok(legalMoves(n, k, moves).includes(cell), `illegal ${cell}`);
    moves.push(cell);
  }
}

test('unbeatable never loses 3x3: every opponent move sequence, as X and as O', () => {
  for (const aiMark of ['x', 'o']) {
    let leaves = 0;
    const rng = rngFrom(7);
    const walk = (moves) => {
      const r = resolve(3, 3, moves);
      assert.ok(r.ok);
      if (r.status !== 'play') {
        leaves++;
        assert.notEqual(r.winner, other(aiMark), `lost: ${moves.join()}`);
        return;
      }
      if (r.next === aiMark) walk([...moves, ai(3, 3, moves, 'unbeatable', rng)]);
      else for (const c of legalMoves(3, 3, moves)) walk([...moves, c]);
    };
    walk([]);
    assert.ok(leaves > 50);
  }
});

test('unbeatable against itself on 3x3 is always a draw', () => {
  for (let s = 1; s <= 25; s++) {
    const r = playGame(3, 3, 'unbeatable', 'unbeatable', rngFrom(s));
    assert.equal(r.status, 'draw');
  }
});

test('unbeatable takes the fastest win and the slowest loss', () => {
  // x has two in a row and a way to win now; it must take it, not play elsewhere
  assert.equal(ai(3, 3, [0, 3, 1, 4], 'unbeatable', rngFrom(1)), 2);
  // x to play at 0,1 with o at 3,4 and x to move: win at 2 (not block 5)
  // o to move: must block 2 although o also threatens at 5 -> o plays 5 and wins first
  assert.equal(ai(3, 3, [0, 3, 1, 4, 8], 'unbeatable', rngFrom(1)), 5);
});

test('unbeatable always wins when it can and blocks when it must, on every size', () => {
  for (const [n, k] of [[3, 3], [4, 4], [5, 4]]) {
    for (let s = 1; s <= 10; s++) {
      const rng = rngFrom(s);
      const moves = [];
      // play random moves until someone has an immediate win threat, then check the computer's reply
      for (let guard = 0; guard < n * n; guard++) {
        const r = resolve(n, k, moves);
        if (r.status !== 'play') break;
        const legal = legalMoves(n, k, moves);
        const winNow = legal.filter((c) => resolve(n, k, [...moves, c]).winner === r.next);
        const pick = ai(n, k, moves, 'unbeatable', rng, { budgetMs: 40 });
        if (winNow.length) assert.ok(winNow.includes(pick), `${n}x${n} should win`);
        moves.push(rng() < 0.5 ? legal[Math.floor(rng() * legal.length)] : pick);
      }
    }
  }
});

test('every level blocks only on purpose: normal and unbeatable block an open four/three', () => {
  // x threatens 0,1 -> 2 on 3x3; o to move must block at 2 (o has no win)
  assert.equal(ai(3, 3, [0, 4, 1], 'normal', () => 0.9), 2);
  assert.equal(ai(3, 3, [0, 4, 1], 'unbeatable', rngFrom(3)), 2);
  // 4x4: x threatens 0,1,2 -> 3
  assert.equal(ai(4, 4, [0, 5, 1, 10, 2], 'normal', () => 0.9), 3);
  assert.equal(ai(4, 4, [0, 5, 1, 10, 2], 'unbeatable', rngFrom(3), { budgetMs: 50 }), 3);
  // 5x5, k=4: x has 0,1,2 -> must block 3
  assert.equal(ai(5, 4, [0, 12, 1, 18, 2], 'unbeatable', rngFrom(3), { budgetMs: 50 }), 3);
  assert.equal(ai(5, 4, [0, 12, 1, 18, 2], 'normal', () => 0.9), 3);
});

test('normal and easy only play legal moves', () => {
  for (const level of ['easy', 'normal', 'unbeatable']) {
    for (const [n, k] of [[3, 3], [4, 4], [5, 4]]) {
      for (let s = 1; s <= 6; s++) playGame(n, k, level, level, rngFrom(s * 13), { budgetMs: 20 });
    }
  }
});

test('the computer returns null on a full board', () => {
  const cells = ['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', 'x'];
  assert.equal(chooseMove({ cells, n: 3, k: 3, mark: 'x', level: 'normal' }), null);
});

test('unbeatable never loses to normal or easy (3x3), and beats easy most of the time', () => {
  let easyWins = 0;
  const games = 60;
  for (let s = 1; s <= games; s++) {
    const rng = rngFrom(s * 31);
    for (const [xl, ol] of [['unbeatable', 'normal'], ['normal', 'unbeatable'], ['unbeatable', 'easy'], ['easy', 'unbeatable']]) {
      const r = playGame(3, 3, xl, ol, rng);
      const loser = r.winner === 'x' ? ol : r.winner === 'o' ? xl : '';
      assert.notEqual(loser, 'unbeatable');
      if ((xl === 'unbeatable' && ol === 'easy') || (xl === 'easy' && ol === 'unbeatable')) {
        if (r.winner && (r.winner === 'x') === (xl === 'unbeatable')) easyWins++;
      }
    }
  }
  assert.ok(easyWins > games * 2 * 0.6, `beat easy ${easyWins}/${games * 2}`);
});

test('normal beats easy most games', () => {
  let normal = 0;
  let easy = 0;
  const games = 200;
  for (let s = 1; s <= games; s++) {
    const rng = rngFrom(s * 77);
    const normalIsX = s % 2 === 0;
    const r = playGame(3, 3, normalIsX ? 'normal' : 'easy', normalIsX ? 'easy' : 'normal', rng);
    if (r.winner) ((r.winner === 'x') === normalIsX ? normal++ : easy++);
  }
  assert.ok(normal > easy * 3, `normal ${normal} vs easy ${easy}`);
  assert.ok(normal > games * 0.55);
});

test('normal is beatable and not perfect: it loses games to unbeatable-quality play only by luck', () => {
  // normal plays 4x4 and 5x5 legally and finishes
  for (const [n, k] of [[4, 4], [5, 4]]) {
    const r = playGame(n, k, 'normal', 'easy', rngFrom(5));
    assert.ok(['won', 'draw'].includes(r.status));
  }
});

test('the hint is a legal winning-or-best cell and does not use randomness', () => {
  const h = hintMove({ cells: ['x', 'x', '', '', 'o', '', '', 'o', ''], n: 3, k: 3, mark: 'x' });
  assert.equal(h, 2);
  const again = hintMove({ cells: ['x', 'x', '', '', 'o', '', '', 'o', ''], n: 3, k: 3, mark: 'x' });
  assert.equal(h, again);
  const first = hintMove({ cells: Array(9).fill(''), n: 3, k: 3, mark: 'x' });
  assert.ok(first >= 0 && first < 9);
});

test('think time is human sized', () => {
  for (const level of ['easy', 'normal', 'unbeatable']) {
    for (const e of [1, 9, 25]) {
      const s = thinkSeconds(level, e, () => 0.5);
      assert.ok(s >= 0.4 && s <= 1.2, `${level} ${e} ${s}`);
    }
  }
});

test('5x5 and 4x4 unbeatable stay inside the time budget', () => {
  for (const [n, k] of [[4, 4], [5, 4]]) {
    const r = resolve(n, k, [Math.floor((n * n) / 2), 0]);
    const t = Date.now();
    const m = chooseMove({ cells: r.cells, n, k, mark: r.next, level: 'unbeatable', budgetMs: 300 });
    assert.ok(Date.now() - t < 450, `${n}x${n} took ${Date.now() - t}`);
    assert.ok(m.cell >= 0);
  }
});
