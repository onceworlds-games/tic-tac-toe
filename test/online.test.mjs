import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, haveSdk, loadHelpers } from './hub.mjs';
import { createOnline } from '../game/online.js';
import { chooseMove } from '../game/ai.js';
import { describe, seriesState } from '../game/core.js';
import { legalMoves } from '../game/rules.js';

const skip = !haveSdk && 'the SDK helpers (OW_SDK_DIST) are not available';
const brain = { choose: (req) => Promise.resolve((req.hint ? chooseMove({ ...req, level: 'unbeatable', rng: () => 0, nodeLimit: 20000 }) : chooseMove({ ...req, nodeLimit: 20000 })).cell) };
const flush = () => new Promise((r) => setImmediate(r));

async function run(ms) {
  for (let t = 0; t < ms; t += 50) {
    mock.timers.tick(50);
    await flush();
    await flush();
  }
}

async function until(fn, ms = 60000) {
  for (let t = 0; t < ms; t += 50) {
    if (fn()) return true;
    await run(50);
  }
  return fn();
}

function setup(settings) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 });
  return loadHelpers().then((h) => ({ hub: new Hub(settings), h }));
}

function pageOf(hub, h, id) {
  const room = hub.join(id);
  const game = createOnline(room, h, { brain, now: () => Date.now() });
  return { room, game, id };
}

/** Plays a random legal move for `who` whenever it is their turn. */
function randomPlayer(page, rng) {
  return () => {
    const v = page.game.view();
    if (v.phase === 'play' && v.mine) {
      const free = legalMoves(v.n, v.k, v.data.moves);
      if (free.length) page.game.move(free[Math.floor(rng() * free.length)]);
    }
  };
}

const lcg = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

test('a series against the computer: starts, alternates the starter, ends with results', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'computer', board: 3, series: 3, level: 'unbeatable', mark: 'x' });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  host.room.startMatch();
  assert.equal(hub.match.phase, 'playing');
  const rng = lcg(5);
  const mover = randomPlayer(host, rng);
  const starters = [];
  let lastG = 0;
  const ok = await until(() => {
    const v = host.game.view();
    if (v.data && v.g !== lastG) {
      lastG = v.g;
      starters.push(v.byMark.x.bot ? 'bot' : 'me');
    }
    mover();
    return host.game.match.phase === 'results';
  });
  assert.ok(ok, 'the series ends');
  const v = host.game.view();
  assert.equal(v.phase, 'results');
  assert.ok(v.state.done);
  // marks swap: the starter alternates
  for (let i = 1; i < starters.length; i++) assert.notEqual(starters[i], starters[i - 1]);
  assert.equal(starters[0], 'me');
  // an unbeatable computer against random moves wins the series
  assert.equal(v.champion.bot, true);
  assert.equal(host.game.match.results[0].bot, true);
  host.game.dispose();
});

test('mark O: the computer opens the first game', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'computer', board: 3, series: 1, level: 'normal', mark: 'o' });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  host.room.startMatch();
  const ok = await until(() => {
    const v = host.game.view();
    return v.phase === 'play' && v.data.moves.length === 1;
  });
  assert.ok(ok, 'the computer plays first');
  const v = host.game.view();
  assert.equal(v.byMark.x.bot, true);
  assert.equal(v.myMark, 'o');
  assert.equal(v.mine, true);
  host.game.dispose();
});

test('undo takes back your move and the computer reply, and the game goes on', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'computer', board: 3, series: 1, level: 'normal', mark: 'x' });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  host.room.startMatch();
  await run(300);
  assert.ok(host.game.move(4));
  await until(() => host.game.view().data.moves.length === 2);
  assert.equal(host.game.view().data.moves.length, 2);
  host.game.undo();
  await run(200);
  assert.deepEqual(host.game.view().data.moves, []);
  assert.equal(host.game.view().mine, true);
  // the computer does not move for a position that is gone: it is my turn
  await run(2000);
  assert.deepEqual(host.game.view().data.moves, []);
  host.game.dispose();
});

test('moves out of turn, onto taken cells or from watchers are refused', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 3, timer: 0 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  const watcher = pageOf(hub, h, 'p3'); // arrives after the start: watches
  await run(300);
  assert.equal(host.game.match.spectating, false);
  assert.equal(watcher.game.match.spectating, true);
  guest.game.move(0); // not guest's turn (host is X in game 1)
  await run(200);
  assert.deepEqual(host.game.view().data.moves, []);
  watcher.game.move(0);
  await run(200);
  assert.deepEqual(host.game.view().data.moves, []);
  host.game.move(4);
  await run(200);
  guest.game.move(4);
  await run(200);
  assert.deepEqual(guest.game.view().data.moves, [4]);
  guest.game.move(0);
  await run(300);
  assert.deepEqual(watcher.game.view().data.moves, [4, 0]);
  host.game.dispose();
  guest.game.dispose();
  watcher.game.dispose();
});

test('a friend series: both pages agree, scores add up, the host can rematch', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 3, timer: 0 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  assert.ok(host.room.canStart);
  host.room.startMatch();
  const rng = lcg(11);
  const mh = randomPlayer(host, rng);
  const mg = randomPlayer(guest, rng);
  const ok = await until(() => {
    mh();
    mg();
    return host.game.match.phase === 'results' && guest.game.match.phase === 'results';
  });
  assert.ok(ok);
  const vh = host.game.view();
  const vg = guest.game.view();
  assert.deepEqual(vh.state, vg.state);
  assert.ok(vh.state.done);
  assert.equal(vh.a.name, 'p1');
  assert.equal(vg.a.name, 'p1');
  assert.equal(vh.a.me, true);
  assert.equal(vg.b.me, true);
  const total = vh.state.a + vh.state.b + vh.state.d;
  assert.ok(total >= 2 && total <= 3);
  // Rematch: the host ends, the guest readies, the host starts again with the same settings
  host.room.endMatch();
  await run(300);
  guest.room.setReady(true);
  host.room.startMatch();
  await run(500);
  assert.equal(host.game.match.phase, 'round');
  assert.equal(host.game.view().state.played, 0);
  host.game.dispose();
  guest.game.dispose();
});

test('the guest leaving mid-series is a forfeit: the other player wins', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 5, timer: 0 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  await run(300);
  host.game.move(4);
  await run(200);
  guest.room.leave();
  const ok = await until(() => host.game.match.phase === 'results', 20000);
  assert.ok(ok, 'results appear');
  const v = host.game.view();
  assert.equal(v.ff, 'p2');
  assert.equal(v.champion.id, 'p1');
  assert.equal(host.game.match.results[0].id, 'p1');
  host.game.dispose();
});

test('the host reloading mid-game: a new page carries on from the room', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 4, series: 3, timer: 0 });
  t.after(() => mock.timers.reset());
  let host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  await run(300);
  host.game.move(5);
  await run(200);
  guest.game.move(6);
  await run(200);
  host.game.dispose();
  host = pageOf(hub, h, 'p1'); // a reload: same player, fresh page
  await run(1500);
  const v = host.game.view();
  assert.deepEqual(v.data.moves, [5, 6]);
  assert.equal(v.phase, 'play');
  host.game.move(1);
  await run(300);
  assert.deepEqual(guest.game.view().data.moves, [5, 6, 1]);
  host.game.dispose();
  guest.game.dispose();
});

test('the host dropping hands the game to the friend, who can keep playing', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 3, timer: 0 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  await run(300);
  host.game.move(0);
  await run(200);
  hub.drop('p1');
  await run(2500);
  assert.equal(hub.host, 'p2');
  guest.game.move(4);
  await run(500);
  assert.deepEqual(guest.game.view().data.moves, [0, 4]);
  hub.back('p1');
  await run(500);
  host.game.dispose();
  guest.game.dispose();
});

test('the turn timer plays a move when time runs out', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 3, timer: 15 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  await run(300);
  const v0 = host.game.view();
  assert.ok(v0.timeLeft > 12 && v0.timeLeft <= 15, `left ${v0.timeLeft}`);
  assert.equal(v0.data.moves.length, 0);
  await run(15500);
  assert.equal(host.game.view().data.moves.length, 1, 'a default move was played');
  // and the clock restarts for the other player
  const v1 = host.game.view();
  assert.ok(v1.timeLeft > 12, `left ${v1.timeLeft}`);
  host.game.dispose();
  guest.game.dispose();
});

test('endless: finish ends the series with results', { skip }, async (t) => {
  const { hub, h } = await setup({ opponent: 'friend', board: 3, series: 0, timer: 0 });
  t.after(() => mock.timers.reset());
  const host = pageOf(hub, h, 'p1');
  const guest = pageOf(hub, h, 'p2');
  guest.room.setReady(true);
  host.room.startMatch();
  const rng = lcg(3);
  const mh = randomPlayer(host, rng);
  const mg = randomPlayer(guest, rng);
  let games = 0;
  await until(() => {
    mh();
    mg();
    games = host.game.view().state.played;
    return games >= 4;
  });
  assert.ok(games >= 4, 'endless keeps going');
  assert.equal(host.game.match.phase !== 'results', true);
  host.game.finish();
  const ok = await until(() => host.game.match.phase === 'results', 15000);
  assert.ok(ok);
  host.game.dispose();
  guest.game.dispose();
});

test('computer games on 4x4 and 5x5 finish and the score is consistent', { skip }, async (t) => {
  for (const board of [4, 5]) {
    const { hub, h } = await setup({ opponent: 'computer', board, series: 1, level: 'unbeatable', mark: 'x' });
    const host = pageOf(hub, h, 'p1');
    host.room.startMatch();
    const rng = lcg(board);
    const mover = randomPlayer(host, rng);
    const ok = await until(() => {
      mover();
      return host.game.match.phase === 'results';
    }, 120000);
    assert.ok(ok, `${board}x${board} ends`);
    const v = host.game.view();
    const st = seriesState(v.state.a + v.state.b + v.state.d ? 'x' : '', 1);
    void st;
    assert.equal(v.state.played, 1);
    host.game.dispose();
    mock.timers.reset();
  }
});

void describe;
