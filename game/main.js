// Tic Tac Toe on Onceworlds: boot, screens, the frame loop, input and the glue between the room, the local game and the drawing.
import { Renderer, PAL } from './render.js';
import { Fx } from './fx.js';
import * as audio from './audio.js';
import { playLayout, stageLayout, cellAt } from './layout.js';
import { boardFor } from './rules.js';
import { createBrain } from './brain.js';
import { createLocal } from './local.js';
import { createOnline, LOBBY_SETTINGS, DEFAULTS } from './online.js';
import { el, glyph, avatar, Scoreboard, place } from './ui.js';
import { buildTitle, buildSetup, buildResult } from './screens.js';
import { LEVEL_NAMES } from './core.js';
import { statusText } from './view.js';

const params = new URLSearchParams(location.search);
const posterName = params.get('poster') || '';
// ?poster=<name> draws the store pictures; ?poster=ui-<screen> shows one of the game's own screens in a fixed state (no platform).
if (posterName && !posterName.startsWith('ui-')) import('./poster.js').then((m) => m.runPoster(posterName));
else boot(posterName).catch((e) => console.error('[tic-tac-toe] boot failed', e));

async function importHelpers() {
  try {
    const [m, h, b] = await Promise.all([import('/__onceworlds/v1/match.js'), import('/__onceworlds/v1/host.js'), import('/__onceworlds/v1/bots.js')]);
    return { createMatch: m.createMatch, createHost: h.createHost, createBots: b.createBots, t: h.t };
  } catch {
    return null;
  }
}

async function boot(preview = '') {
  const ow = preview ? null : window.onceworlds || null;
  // Join first, before anything is built, so a reload keeps its seat.
  const joining = ow && ow.rooms && ow.rooms.join ? Promise.resolve(ow.rooms.join({ private: true, maxPlayers: 2, minPlayers: 1, lobby: 'game', countdown: 0, settings: LOBBY_SETTINGS })).catch(() => null) : Promise.resolve(null);
  const helpersP = importHelpers();

  const cv = document.getElementById('cv');
  const uiRoot = document.getElementById('ui');
  const renderer = new Renderer(cv);
  const fx = new Fx();
  const brain = createBrain();
  const reduced = () => !!(ow && ow.settings && ow.settings.reducedMotion);
  try {
    ow?.ui?.setLook?.({ accent: '#ffc14a', panel: '#1d120c', text: '#f7eedb' });
  } catch {}

  // ---------------------------------------------------------------- saved things
  const emptyRec = () => ({ w: 0, l: 0, d: 0 });
  let prefs = { opponent: 'computer', level: 'normal', mark: 'x', board: 3, series: 5, timer: 0 };
  let stats = { computer: { easy: emptyRec(), normal: emptyRec(), unbeatable: emptyRec() }, friend: emptyRec(), same: 0, wins: 0, streak: 0, hinted: 0 };
  const saved = async (key) => {
    try {
      return ow && ow.save ? await Promise.race([ow.save.get(key), new Promise((r) => setTimeout(() => r(null), 2500))]) : null;
    } catch {
      return null;
    }
  };
  const save = (key, value) => {
    try {
      ow?.save?.set?.(key, value);
    } catch {}
  };
  const sanitizePrefs = (p) => {
    if (!p || typeof p !== 'object') return;
    if (['computer', 'same', 'friend'].includes(p.opponent)) prefs.opponent = p.opponent;
    if (['easy', 'normal', 'unbeatable'].includes(p.level)) prefs.level = p.level;
    if (p.mark === 'x' || p.mark === 'o') prefs.mark = p.mark;
    if ([3, 4, 5].includes(p.board)) prefs.board = p.board;
    if ([1, 3, 5, 0].includes(p.series)) prefs.series = p.series;
    if ([0, 15, 30].includes(p.timer)) prefs.timer = p.timer;
  };
  const mergeStats = (s) => {
    if (!s || typeof s !== 'object') return;
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const rec = (r) => ({ w: num(r?.w), l: num(r?.l), d: num(r?.d) });
    for (const lv of ['easy', 'normal', 'unbeatable']) stats.computer[lv] = rec(s.computer?.[lv]);
    stats.friend = rec(s.friend);
    stats.same = num(s.same);
    stats.wins = num(s.wins);
    stats.streak = num(s.streak);
    stats.hinted = num(s.hinted);
  };

  let me = { id: '', name: 'You' };
  try {
    const p = ow && ow.player ? await Promise.race([ow.player.get(), new Promise((r) => setTimeout(() => r(null), 2500))]) : null;
    if (p && p.name) me = { id: p.id || '', name: String(p.name).slice(0, 24) };
  } catch {}
  sanitizePrefs(await saved('prefs'));
  mergeStats(await saved('stats'));

  // ---------------------------------------------------------------- the room
  const room = await joining;
  const helpers = room ? await helpersP : null;
  let online = null;
  if (room && helpers) {
    try {
      online = createOnline(room, helpers, { brain });
    } catch (e) {
      console.error('[tic-tac-toe] room setup failed', e);
    }
  }
  const usable = !!online;
  if (room) room.on('error', (e) => console.warn('[tic-tac-toe] room:', e && e.code, e && e.message));

  // ---------------------------------------------------------------- the DOM
  const title = buildTitle({ onPlay: () => onPlay() });
  const setup = buildSetup({ onPick, onStart: () => startFromSetup(), onInvite: () => ow?.ui?.showInvite?.(), onReady: () => toggleReady() }, ow);
  const result = buildResult({ onRematch: () => rematch(), onSetup: () => backToSetup() }, ow);
  const scoreEl = el('div');
  scoreEl.id = 'score';
  const statusEl = el('div');
  statusEl.id = 'status';
  const actionsEl = el('div');
  actionsEl.id = 'actions';
  const bannerEl = el('div');
  bannerEl.id = 'banner';
  const toastEl = el('div');
  toastEl.id = 'toast';
  const btn = (label) => {
    const b = el('button', 'btn', label);
    b.type = 'button';
    return b;
  };
  const undoBtn = btn('Undo');
  const hintBtn = btn('Hint');
  const quitBtn = btn('Quit');
  actionsEl.append(undoBtn, hintBtn, quitBtn);
  uiRoot.append(title.root, setup.root, scoreEl, statusEl, actionsEl, bannerEl, result.root, toastEl);
  const score = new Scoreboard(scoreEl, ow, (n) => audio.flip(n));
  for (const n of [title.root, setup.root, scoreEl, statusEl, actionsEl, bannerEl, result.root]) n.hidden = true;

  // ---------------------------------------------------------------- state
  let screen = 'title';
  let local = null;
  let localId = 0;
  let w = 0;
  let h = 0;
  let L = null; // current layout
  let clock = 0;
  const later = [];
  const after = (sec, fn) => later.push({ at: clock + sec, fn });
  let lastSig = '';
  let pointer = { x: -1, y: -1, mouse: false };
  let cursor = -1;
  let hoverCell = -1;
  let quitArmed = 0;
  let wantStart = 0; // seconds a host's rematch waits for the lobby
  let autoReady = false;
  let hintsMatch = '';
  let hintsUsed = 0;
  let toastTimer = 0;
  let setupBoardPop = 0;

  const anim = { key: '', shown: [], placed: {}, removed: [], lines: null, lineAt: null, winner: '', status: 'play', drawAt: null, endedKey: '', hint: null, pending: null, silent: false, bannerKey: '', n: 3, last: -1 };

  // The demo on the title screen: two computers, a game after game.
  function newDemo() {
    const d = createLocal({ mode: 'demo', board: 3, games: 0, firstMark: 'x', a: { name: 'Coral', ai: 'normal' }, b: { name: 'Gold', ai: 'unbeatable' }, brain, beat: 1.6, pace: 0.55 });
    d.start();
    return d;
  }
  let demo = newDemo();

  // ---------------------------------------------------------------- helpers
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  let previewFriend = null;
  function friendInRoom() {
    if (previewFriend) return previewFriend;
    if (!room || !usable) return null;
    return room.online.find((p) => p.id !== room.me.id) || null;
  }
  const isHost = () => !room || !usable || room.isHost;
  const effOpponent = () => (friendInRoom() ? 'friend' : prefs.opponent === 'friend' && !usable ? 'computer' : prefs.opponent);

  function recordLine(mode, level) {
    const r = mode === 'friend' ? stats.friend : mode === 'computer' ? stats.computer[level] || emptyRec() : null;
    if (!r || r.w + r.l + r.d === 0) return '';
    return `${r.w} W · ${r.l} L · ${r.d} D`;
  }
  function totalLine() {
    let r = { ...stats.friend };
    for (const lv of ['easy', 'normal', 'unbeatable']) {
      r.w += stats.computer[lv].w;
      r.l += stats.computer[lv].l;
      r.d += stats.computer[lv].d;
    }
    return r.w + r.l + r.d ? `Record ${r.w} W · ${r.l} L · ${r.d} D` : '';
  }

  // ---------------------------------------------------------------- sizing
  // A preview named ...-390x844 is laid out for that window size and scaled into whatever the picture's size is (to look at a phone).
  const fixed = (() => {
    const m = /-(\d+)x(\d+)$/.exec(preview);
    return m ? { w: +m[1], h: +m[2] } : null;
  })();
  function resize() {
    w = fixed ? fixed.w : Math.max(200, window.innerWidth);
    h = fixed ? fixed.h : Math.max(200, window.innerHeight);
    let pr = ow && ow.settings && ow.settings.pixelRatio ? ow.settings.pixelRatio(2) : Math.min(window.devicePixelRatio || 1, 2);
    if (fixed) {
      const k = Math.min(window.innerWidth / fixed.w, window.innerHeight / fixed.h);
      pr = Math.max(1, Math.min(3, k * (window.devicePixelRatio || 1)));
      document.body.style.background = '#000';
      for (const e of [cv, uiRoot]) {
        Object.assign(e.style, { position: 'absolute', inset: 'auto', left: `${(window.innerWidth - fixed.w * k) / 2}px`, top: `${(window.innerHeight - fixed.h * k) / 2}px`, width: `${fixed.w}px`, height: `${fixed.h}px`, transformOrigin: '0 0', transform: `scale(${k})`, overflow: 'hidden' });
      }
    }
    renderer.resize(w, h, pr);
    layout();
  }

  function layout() {
    const reserved = ow && ow.ui ? ow.ui.reserved : null;
    if (screen === 'play') {
      const v = currentView();
      L = playLayout(w, h, reserved, { actions: true, status: true });
      place(scoreEl, L.score);
      scoreEl.classList.toggle('tight', L.score.mode === 'col' && L.score.h < 340);
      place(statusEl, L.status);
      place(actionsEl, L.actions);
      // the platform's lobby strip keeps the bottom clear in the lobby only; in play nothing but the menu is in our way
      void v;
    } else if (screen === 'title') {
      const S = stageLayout(w, h, reserved, {});
      L = { board: S.board };
      place(title.root, S.text);
    } else if (screen === 'setup') {
      const strip = (reserved || []).find((r) => r && r.kind === 'lobby');
      const bottomClear = strip ? Math.max(0, h - strip.y) : 0;
      const landscape = w >= h * 1.05;
      const wide = landscape || w >= 560;
      setupWide = wide;
      if (landscape) {
        const S = stageLayout(w, h, reserved, { panel: 1 });
        L = { board: S.board };
        place(setup.root, { x: S.text.x, y: S.text.y, w: S.text.w, h: S.text.h - bottomClear });
      } else {
        const topPad = Math.round((reserved || []).find((r) => r && r.kind === 'menu') ? 0 : 0) + 64;
        const content = setup.root.scrollHeight || 380;
        const panelH = Math.max(260, Math.min(content + 8, Math.round(h * 0.7) - bottomClear));
        const pad = 12;
        const boardArea = h - topPad - panelH - bottomClear - pad;
        const s = Math.floor(Math.max(110, Math.min(w - pad * 2, boardArea)));
        L = { board: { x: Math.round((w - s) / 2), y: topPad + Math.max(0, Math.round((boardArea - s) / 2)), s } };
        place(setup.root, { x: 0, y: h - panelH - bottomClear, w, h: panelH });
      }
    }
  }
  let setupWide = false;

  // ---------------------------------------------------------------- screens
  function showScreen(next) {
    screen = next;
    title.root.hidden = next !== 'title';
    setup.root.hidden = next !== 'setup';
    for (const n of [scoreEl, statusEl, actionsEl]) n.hidden = next !== 'play';
    if (next !== 'play') {
      bannerEl.hidden = true;
      result.root.hidden = true;
    }
    audio.setScene(next === 'play' ? 'play' : 'menu');
    try {
      ow?.controls?.set?.(null);
    } catch {}
    layout();
  }

  function onPlay() {
    audio.startAudio();
    audio.tap();
    if (online && room.match.phase !== 'lobby') showScreen('play');
    else showScreen('setup');
  }

  function stopLocal() {
    local = null;
    localId++;
  }

  let leavingUntil = 0;
  function backToSetup() {
    audio.tap();
    leavingUntil = clock + 2;
    if (local) {
      stopLocal();
      showScreen('setup');
      return;
    }
    if (online && room.isHost) {
      wantStart = 0;
      room.endMatch();
    }
    showScreen('setup');
  }

  function rematch() {
    audio.tap();
    if (local) {
      local.restart();
      anim.key = '';
      return;
    }
    if (!online) return;
    if (room.isHost) {
      wantStart = 10;
      room.endMatch();
    } else {
      autoReady = true;
      refreshResult();
    }
  }

  function toggleReady() {
    audio.tap();
    if (room) room.setReady(!room.me.ready);
  }

  // ---------------------------------------------------------------- setup
  function syncRoomSettings() {
    if (!online || !room.isHost || room.match.phase !== 'lobby') return;
    const want = { opponent: friendInRoom() || prefs.opponent === 'friend' ? 'friend' : 'computer', board: prefs.board, series: prefs.series, level: prefs.level, mark: prefs.mark, timer: prefs.timer };
    const have = room.settings;
    for (const id of Object.keys(want)) if (have[id] !== want[id]) room.setSetting(id, want[id]);
  }

  function onPick(id, value) {
    audio.tap();
    prefs[id] = value;
    if (id === 'opponent') {
      // a series against a friend is shorter by default
      prefs.series = value === 'friend' ? 3 : 5;
    }
    if (id === 'board') setupBoardPop = clock;
    save('prefs', prefs);
    syncRoomSettings();
    layout();
  }

  function setupModel() {
    const f = friendInRoom();
    const opp = effOpponent();
    const host = isHost();
    const alone = !f;
    const m = {
      host,
      standalone: !usable,
      wide: setupWide,
      prefs: { ...prefs, opponent: opp },
      alone,
      friend: f && host ? { name: f.name, avatarId: f.id, ready: !!f.ready } : null,
      me: { name: me.name, avatarId: me.id, ready: !!(room && room.me && room.me.ready) },
      hostPlayer: { name: 'Host', avatarId: '' },
      settings: { board: boardFor(Number(room?.settings?.board) || 3).n, series: Number(room?.settings?.series ?? 5), timer: Number(room?.settings?.timer) || 0 },
      canStart: true,
      startLabel: 'Start',
      note: '',
    };
    if (!host && room) {
      const hp = room.players.get(room.host);
      m.hostPlayer = { name: hp ? hp.name : 'Host', avatarId: room.host };
    }
    if (host) {
      if (opp === 'friend') {
        if (!f) {
          m.canStart = false;
          m.startLabel = 'Start';
          m.note = '';
        } else if (!f.ready) {
          m.canStart = false;
          m.startLabel = `Waiting for ${f.name}`;
        }
      }
    }
    return m;
  }

  function startFromSetup() {
    audio.startAudio();
    const opp = effOpponent();
    if (opp === 'same' || !usable) return startLocal(opp === 'same' ? 'same' : 'computer');
    if (!room.isHost) return;
    syncRoomSettings();
    audio.begin();
    room.startMatch();
  }

  function startLocal(mode) {
    stopLocal();
    const id = ++localId;
    const mark = prefs.mark === 'o' ? 'o' : 'x';
    local = createLocal({
      mode,
      board: prefs.board,
      games: prefs.series,
      firstMark: mark,
      a: { name: mode === 'same' ? 'Player 1' : me.name, avatarId: me.id },
      b: { name: mode === 'same' ? 'Player 2' : 'Computer', ai: mode === 'computer' ? prefs.level : '' },
      brain,
      beat: 3,
    });
    local.id = id;
    local.start();
    anim.key = '';
    audio.begin();
    showScreen('play');
  }

  // ---------------------------------------------------------------- the view
  function currentView() {
    if (screen === 'title') return demo.view();
    if (local) return local.view();
    if (online) return online.view({ hintsLeft: Math.max(0, 3 - hintsUsed) });
    return null;
  }

  // ---------------------------------------------------------------- animation bookkeeping
  const markColor = (m) => (m === 'x' ? PAL.x.base : PAL.o.base);

  function cellCenter(c, n) {
    const b = L.board;
    const inset = b.s * 0.045;
    const cs = (b.s - inset * 2) / n;
    return { x: b.x + inset + (c % n) * cs + cs / 2, y: b.y + inset + Math.floor(c / n) * cs + cs / 2, cs };
  }

  function resetAnim(v, key) {
    anim.key = key;
    anim.shown = new Array(v.n * v.n).fill('');
    anim.placed = {};
    anim.removed = [];
    anim.lines = null;
    anim.lineAt = null;
    anim.winner = '';
    anim.status = 'play';
    anim.drawAt = null;
    anim.endedKey = '';
    anim.hint = null;
    anim.pending = null;
    anim.n = v.n;
    anim.last = -1;
    anim.silent = v.data.moves.length > 1;
    bannerEl.hidden = true;
    result.root.hidden = true;
    fx.clear();
  }

  function onDrop(c, mark, v, silent) {
    if (silent) return;
    audio.place(mark);
    const p = cellCenter(c, v.n);
    after(0.11, () => {
      fx.dust(p.x, p.y + p.cs * 0.25, '#f7eedb', 6, p.cs / 90);
    });
    fx.shake(0.05);
  }

  function syncPieces(v, key, quiet) {
    if (!v.data) {
      anim.key = '';
      return;
    }
    if (anim.key !== key || anim.n !== v.n) resetAnim(v, key);
    const target = v.game.ok ? v.game.cells.slice() : new Array(v.n * v.n).fill('');
    // a move this page just made shows at once, before the host has confirmed it
    const pend = anim.pending;
    if (pend) {
      if (target[pend.cell] || clock - pend.at > 1.4 || v.next !== pend.mark || v.phase !== 'play') anim.pending = null;
      else target[pend.cell] = pend.mark;
    }
    for (let c = 0; c < target.length; c++) {
      const want = target[c];
      const have = anim.shown[c];
      if (want && want !== have) {
        anim.shown[c] = want;
        anim.placed[c] = anim.silent ? -10 : clock;
        onDrop(c, want, v, anim.silent || quiet);
      } else if (!want && have) {
        anim.shown[c] = '';
        delete anim.placed[c];
        anim.removed.push({ cell: c, mark: have, at: clock });
      }
    }
    anim.silent = false;
    anim.last = v.game.ok && v.game.last >= 0 ? v.game.last : -1;
    anim.removed = anim.removed.filter((r) => clock - r.at < 0.3);

    // how the game ended
    if (v.game.ok && v.game.status !== 'play' && anim.endedKey !== key) {
      anim.endedKey = key;
      onEnded(v, key, quiet);
    }
  }

  function onEnded(v, key, quiet) {
    const res = v.result;
    if (!res) return;
    const late = clock - (anim.firstFrameAt || 0) < 0.2 && v.data.moves.length > 1; // seen already finished (a reload)
    anim.status = v.game.status;
    if (v.game.status === 'won') {
      anim.lines = v.game.lines;
      anim.winner = v.game.winner;
      anim.lineAt = late ? clock - 5 : clock + 0.2;
    } else if (v.game.status === 'draw') anim.drawAt = late ? clock - 5 : clock + 0.15;
    if (late) gamesCounted.add(key); // finished before this page looked: already counted
    if (late || quiet) {
      showBanner(v, key);
      return;
    }
    const iWon = res.winner && res.winner.me && v.mode !== 'same';
    const iLost = res.loser && res.loser.me && v.mode !== 'same' && v.mode !== 'demo';
    const celebrate = v.mode === 'same' || v.mode === 'demo' || v.spectating || iWon || (v.mode === 'friend' && res.winner && !res.winner.me && false);
    if (v.game.status === 'won') {
      fx.hitStop(70);
      fx.shake(0.5);
      after(0.2, () => audio.whoosh());
      after(0.55, () => {
        const pts = (anim.lines || []).flat();
        for (const c of pts) {
          const p = cellCenter(c, v.n);
          fx.sparks(p.x, p.y, markColor(v.game.winner), 8, 0.8);
        }
        if (v.mode === 'demo') return;
        if (iLost) audio.lose();
        else audio.win();
        audio.duck();
        if (celebrate && L) fx.confetti(w, h, [PAL.x.base, PAL.o.base, PAL.cream, '#7fb2ff'], 90);
      });
    } else if (v.game.status === 'draw') {
      fx.shake(0.22);
      after(0.2, () => v.mode !== 'demo' && audio.drawGame());
    } else if (v.game.status === 'forfeit') {
      after(0.1, () => audio.deny());
    }
    after(v.game.status === 'won' ? 0.95 : 0.6, () => {
      if (anim.key === key) showBanner(v, key);
    });
  }

  function showBanner(v, key) {
    const res = v.result;
    if (!res || screen !== 'play') return;
    let text = '';
    let edge = PAL.cream;
    const mark = res.mark;
    if (res.kind === 'draw') text = 'Draw';
    else if (res.kind === 'forfeit') text = `${res.loser ? res.loser.name : 'Player'} left`;
    else {
      text = res.winner && res.winner.me && v.mode !== 'same' ? 'You win' : `${res.winner ? res.winner.name : '?'} wins`;
      edge = markColor(mark);
    }
    bannerEl.textContent = '';
    const tape = el('div', 'tape');
    tape.style.setProperty('--edge', edge);
    if (mark && res.kind !== 'forfeit') tape.appendChild(glyph(mark));
    const t = el('span', null, text);
    tape.appendChild(t);
    if (res.kind === 'draw') {
      tape.prepend(glyph('x'));
      tape.append(glyph('o'));
    }
    bannerEl.appendChild(tape);
    anim.bannerKey = key;
    bannerEl.hidden = false;
    place(bannerEl, { x: 0, y: 0, w: 0, h: 0 });
    bannerEl.style.width = '';
    bannerEl.style.height = '';
    if (L) {
      // portrait: in the free space above the board; landscape: across the board
      const above = !L.landscape && L.status.y > L.board.y - 120;
      bannerEl.style.left = `${Math.round(L.board.x + L.board.s / 2)}px`;
      bannerEl.style.top = `${Math.round(L.landscape ? L.board.y + L.board.s / 2 : Math.max(L.score.y + L.score.h + 44, L.board.y - 46))}px`;
      bannerEl.style.fontSize = `${Math.round(Math.min(L.board.s * 0.115, 56))}px`;
      void above;
    }
  }

  // ---------------------------------------------------------------- stats and badges
  const gamesCounted = new Set();
  function countGame(v, key) {
    if (!v.result || gamesCounted.has(key) || v.spectating || v.mode === 'demo') return;
    gamesCounted.add(key);
    if (v.mode === 'same') {
      stats.same += 1;
      save('stats', stats);
      return;
    }
    const mineSeat = v.a && v.a.me ? v.a : v.b && v.b.me ? v.b : null;
    if (!mineSeat) return;
    const r = v.result;
    const won = r.kind !== 'draw' && r.winner && r.winner.me;
    const lost = r.kind !== 'draw' && r.loser && r.loser.me;
    const bucket = v.mode === 'friend' ? stats.friend : stats.computer[v.level] || stats.computer.normal;
    if (r.kind === 'forfeit') return;
    if (won) {
      bucket.w++;
      stats.wins++;
      stats.streak++;
      ow?.leaderboards?.submit?.('wins', stats.wins)?.catch?.(() => {});
      if (v.mode === 'computer') award('first-win');
      if (stats.streak >= 3) award('hat-trick');
      if (v.n === 5 && v.mode === 'computer' && (v.level === 'normal' || v.level === 'unbeatable')) award('big-board');
    } else if (lost) {
      bucket.l++;
      stats.streak = 0;
    } else {
      bucket.d++;
      stats.streak = 0;
      if (v.mode === 'computer' && v.level === 'unbeatable' && v.n === 3) award('stalemate');
    }
    if (hintsUsed > 0 && won) stats.hinted++;
    save('stats', stats);
  }
  const awarded = new Set();
  function award(id) {
    if (awarded.has(id)) return;
    awarded.add(id);
    try {
      ow?.badges?.award?.(id)?.catch?.(() => {});
    } catch {}
  }
  const seriesDone = new Set();
  function countSeries(v) {
    const key = room && room.match ? room.match.id : `l${localId}`;
    if (seriesDone.has(key)) return;
    seriesDone.add(key);
    if (v.mode === 'friend' && v.champion && v.champion !== 'draw' && v.champion.me && !v.ff && !v.spectating) award('friend-win');
    if (v.champion && v.champion !== 'draw' && v.champion.me && v.mode !== 'demo' && v.mode !== 'same') {
      audio.fanfare();
      fx.confetti(w, h, [PAL.x.base, PAL.o.base, PAL.cream, '#7fb2ff'], 160);
    }
  }

  // ---------------------------------------------------------------- actions
  function doMove(cell) {
    const v = currentView();
    if (!v || v.phase !== 'play') return;
    if (local && v.mode === 'same') {
      if (!local.move(cell)) audio.deny();
      return;
    }
    if (local) {
      if (!v.mine || !local.move(cell, v.turnP.id)) audio.deny();
      return;
    }
    if (!online || v.spectating) return;
    if (!v.mine) {
      audio.deny();
      return;
    }
    if (v.game.cells[cell]) {
      audio.deny();
      return;
    }
    anim.pending = { cell, mark: v.next, at: clock };
    online.move(cell);
  }

  function doUndo() {
    const v = currentView();
    if (!v || !v.canUndo) return audio.deny();
    audio.undo();
    anim.pending = null;
    if (local) local.undo();
    else online.undo();
  }

  async function doHint() {
    const v = currentView();
    if (!v || !v.canHint) return audio.deny();
    const used = local ? 3 - local.hintsLeft : hintsUsed;
    void used;
    if (local) local.useHint();
    else hintsUsed++;
    audio.hint();
    const cell = await brain.choose({ hint: true, cells: v.game.cells, n: v.n, k: v.k, mark: v.next, budgetMs: 220 });
    if (cell >= 0) anim.hint = { cell, mark: v.next, until: clock + 2 };
  }

  function doQuit() {
    const v = currentView();
    if (!v) return;
    if (v.games === 0 && v.state.played > 0 && (local || room.isHost) && v.phase !== 'results') {
      // endless: Finish shows the result
      audio.tap();
      if (local) local.finish();
      else online.finish();
      return;
    }
    if (!quitArmed) {
      quitArmed = 2.5;
      audio.tap();
      refreshActions(v, true);
      return;
    }
    quitArmed = 0;
    backToSetup();
  }

  undoBtn.addEventListener('click', doUndo);
  hintBtn.addEventListener('click', doHint);
  quitBtn.addEventListener('click', doQuit);

  function refreshActions(v, force) {
    const showUndo = v.mode === 'computer' || v.mode === 'same';
    const showHint = v.mode === 'computer';
    const canQuit = !!local || (online && room.isHost);
    const endless = v.games === 0 && v.state.played > 0;
    const sig = [showUndo, showHint, v.canUndo, v.canHint, v.hintsLeft, canQuit, endless, quitArmed > 0, v.phase].join();
    if (sig === lastSig && !force) return;
    lastSig = sig;
    undoBtn.hidden = !showUndo;
    hintBtn.hidden = !showHint;
    quitBtn.hidden = !canQuit;
    undoBtn.disabled = !v.canUndo;
    hintBtn.disabled = !v.canHint;
    hintBtn.textContent = '';
    hintBtn.append('Hint');
    if (showHint) {
      const n = el('span', 'n', String(v.hintsLeft));
      hintBtn.append(' ', n);
    }
    quitBtn.textContent = endless ? 'Finish' : quitArmed > 0 ? 'Sure?' : 'Quit';
    quitBtn.disabled = v.phase === 'results';
  }

  // ---------------------------------------------------------------- the result card
  function refreshResult() {
    const v = currentView();
    if (!v || v.phase !== 'results') {
      result.root.hidden = true;
      return;
    }
    const ch = v.champion;
    const draw = ch === 'draw';
    const canRematch = !!local || (online && !v.spectating && (room.isHost || true));
    const guest = !local && online && !room.isHost;
    result.update({
      over: 'Series over',
      champion: draw ? null : ch,
      championDraw: draw,
      a: v.a,
      b: v.b,
      state: v.state,
      why: v.ff ? `${(v.a.id === v.ff ? v.a : v.b).name} left the game` : '',
      canRematch,
      canSetup: !guest && !v.spectating,
      rematchLabel: guest ? (autoReady ? 'Waiting for host' : 'Rematch') : 'Rematch',
      waiting: guest && autoReady,
      record: v.mode === 'computer' ? `${LEVEL_NAMES[v.level] || ''}  ${recordLine('computer', v.level)}` : v.mode === 'friend' ? recordLine('friend') : '',
    });
    if (result.root.hidden) {
      result.root.hidden = false;
      bannerEl.hidden = true;
    }
  }

  // ---------------------------------------------------------------- input
  function boardPointer(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  cv.addEventListener('pointerdown', (e) => {
    audio.startAudio();
    pointer = { ...boardPointer(e), mouse: e.pointerType === 'mouse' };
    cursor = -1;
    if (screen !== 'play' || !L) return;
    const v = currentView();
    if (!v || !v.data) return;
    const c = cellAt(L.board, v.n, pointer.x, pointer.y);
    if (c >= 0) doMove(c);
  });
  cv.addEventListener('pointermove', (e) => {
    pointer = { ...boardPointer(e), mouse: e.pointerType === 'mouse' };
  });
  cv.addEventListener('pointerleave', () => {
    pointer = { x: -1, y: -1, mouse: false };
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat && !/^Arrow/.test(e.key)) return;
    audio.startAudio();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onPlay();
      return;
    }
    if (screen !== 'play') return;
    const v = currentView();
    if (!v) return;
    const n = v.n;
    const k = e.key;
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      if (cursor < 0) cursor = Math.floor((n * n) / 2);
      else {
        const x = cursor % n;
        const y = Math.floor(cursor / n);
        const nx = k === 'ArrowLeft' ? x - 1 : k === 'ArrowRight' ? x + 1 : x;
        const ny = k === 'ArrowUp' ? y - 1 : k === 'ArrowDown' ? y + 1 : y;
        if (nx >= 0 && nx < n && ny >= 0 && ny < n) cursor = ny * n + nx;
      }
      audio.lift();
    } else if ((k === 'Enter' || k === ' ') && document.activeElement === document.body) {
      e.preventDefault();
      if (cursor >= 0) doMove(cursor);
    } else if (k === 'z' || k === 'Z' || k === 'u' || k === 'U') doUndo();
    else if (k === 'h' || k === 'H') doHint();
    else if (/^[1-9]$/.test(k) && n === 3) doMove(Number(k) - 1);
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  try {
    ow?.on?.('reserved', layout);
    ow?.settings?.on?.('change', () => {
      fx.reduced = reduced();
      resize();
    });
  } catch {}
  fx.reduced = reduced();

  // ---------------------------------------------------------------- the room's events
  function roomMatchChanged() {
    if (!online) return;
    const phase = room.match.phase;
    if (phase !== 'lobby' && screen !== 'play') {
      if (clock < leavingUntil) return;
      showScreen('play');
    } else if (phase === 'lobby' && screen === 'play' && !local) {
      if (wantStart > 0 || autoReady) return; // a rematch is on its way
      showScreen('setup');
    }
  }
  if (room && usable) {
    for (const ev of ['match', 'matchstart', 'matchend']) room.on(ev, roomMatchChanged);
    room.on('matchstart', () => {
      gamesCounted.clear();
      hintsUsed = 0;
      hintsMatch = room.match.id;
    });
    room.on('settings', () => layout());
    room.on('host', () => {
      syncRoomSettings();
      layout();
    });
    room.on('join', () => {
      layout();
      if (local && local.view().mode === 'same') {
        stopLocal();
        showScreen('setup');
        toast('Friend joined');
      }
    });
    room.on('leave', (p) => {
      if (screen === 'setup') layout();
      void p;
    });
  }

  // ---------------------------------------------------------------- the frame
  let last = performance.now();
  anim.firstFrameAt = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const step = fx.tick(dt);
    clock += dt;
    for (let i = later.length - 1; i >= 0; i--) {
      if (later[i].at <= clock) {
        const f = later.splice(i, 1)[0];
        try {
          f.fn();
        } catch (e) {
          console.error(e);
        }
      }
    }
    void step;
    if (quitArmed > 0) {
      quitArmed -= dt;
      if (quitArmed <= 0) {
        quitArmed = 0;
        lastSig = '';
      }
    }
    if (screen === 'title') demo.tick(dt);
    if (local) local.tick(dt);

    // a friend joining a same-screen game ends it; a host's rematch waits for the lobby
    if (local && local.view().mode === 'same' && room && usable && room.online.length > 1) {
      stopLocal();
      showScreen('setup');
      toast('Friend joined');
    }
    if (online) {
      roomMatchChanged();
      if (wantStart > 0) {
        wantStart -= dt;
        if (room.match.phase === 'lobby' && room.isHost) {
          const f = friendInRoom();
          if (room.canStart && (!f || f.ready || effOpponent() !== 'friend')) {
            wantStart = 0;
            syncRoomSettings();
            room.startMatch();
          }
        }
      }
      if (autoReady && room.match.phase === 'lobby') {
        room.setReady(true);
        autoReady = false;
      }
      if (screen === 'setup' && room.isHost) syncRoomSettings();
    }

    // what to draw
    let v = null;
    let key = '';
    if (screen === 'title' || screen === 'play') {
      v = currentView();
      if (v && v.data) key = screen === 'title' ? `demo${demo === null ? 0 : demo.view().g}.${v.g}` : local ? `l${localId}.${v.data.g}` : `${room.match.id}.${v.data.g}`;
    }
    const empty = !v || !v.data;
    if (screen === 'play' && v) {
      if (!anim.firstFrameAt) anim.firstFrameAt = clock;
      if (empty) {
        // waiting for the host's first word
        const n = boardFor(Number(room?.settings?.board) || prefs.board).n;
        if (anim.n !== n || anim.key !== '') {
          anim.key = '';
          anim.n = n;
          anim.shown = new Array(n * n).fill('');
          anim.placed = {};
          anim.lines = null;
          anim.lineAt = null;
          anim.status = 'play';
        }
      }
    }
    if (v && v.data) syncPieces(v, key, screen === 'title');
    if (screen === 'play' && v && v.data) {
      if (v.phase === 'play' || v.phase === 'between' || v.phase === 'results') countGame(v, key);
      if (v.phase === 'results') countSeries(v);
    }

    // the interface
    if (screen === 'title') {
      title.update({ record: totalLine() });
    } else if (screen === 'setup') {
      setup.update(setupModel());
      if (setup.root.scrollHeight && Math.abs((setup.root.dataset.sh | 0) - setup.root.scrollHeight) > 2) {
        setup.root.dataset.sh = String(setup.root.scrollHeight);
        layout();
      }
    } else if (screen === 'play' && v) {
      layout_if_needed();
      score.update(v.a && v.b ? v : fallbackView(), L && L.score.mode);
      scoreEl.hidden = !(v.a && v.b);
      const text = v.phase === 'wait' || empty ? 'Get ready' : statusText(v);
      setStatus(v, text);
      refreshActions(v, false);
      if (v.phase === 'results') refreshResult();
      else if (!result.root.hidden) result.root.hidden = true;
      if (v.phase === 'play' && !bannerEl.hidden && anim.bannerKey !== key) bannerEl.hidden = true;
      if (v.phase === 'play' && anim.endedKey !== key) bannerEl.hidden = true;
    }

    // the scene
    const bd = (L && L.board) || { x: 0, y: 0, s: Math.min(w, h) * 0.8 };
    const n = screen === 'setup' ? prefs.board : v && v.data ? v.n : anim.n || 3;
    let cells = anim.shown;
    if (screen === 'setup' || !cells || cells.length !== n * n) cells = new Array(n * n).fill('');
    let hover = null;
    if (screen === 'play' && v && v.canMove && pointer.mouse && L) {
      const c = cellAt(L.board, v.n, pointer.x, pointer.y);
      if (c >= 0 && !cells[c]) hover = { cell: c, mark: v.next };
      hoverCell = c;
    }
    const scene = {
      t: clock,
      board: bd,
      n,
      cells,
      last: screen === 'play' || screen === 'title' ? anim.last : -1,
      placed: anim.placed,
      removed: anim.removed,
      lines: anim.lines,
      lineAt: anim.lineAt,
      winner: anim.winner,
      status: screen === 'setup' ? 'play' : anim.status,
      turn: screen === 'play' && v && v.phase === 'play' ? v.next : '',
      hover,
      hint: anim.hint,
      cursor: screen === 'play' && cursor >= 0 && v && v.canMove ? cursor : -1,
      drawAt: anim.drawAt,
      pop: setupBoardPop,
      shake: fx.offset(Math.min(w, h) / 500),
      fx,
      dim: screen === 'title' ? 0.18 : 0,
    };
    renderer.frame(scene);
  }

  let layoutSig = '';
  function layout_if_needed() {
    const r = ow && ow.ui && ow.ui.reserved;
    const sig = `${w}x${h}|${r ? r.map((q) => `${q.kind}${q.x | 0},${q.y | 0},${q.w | 0},${q.h | 0}`).join(';') : ''}`;
    if (sig !== layoutSig) {
      layoutSig = sig;
      layout();
    }
  }

  function fallbackView() {
    return { a: null, b: null };
  }

  let statusSig = '';
  function setStatus(v, text) {
    const mark = v.phase === 'play' && v.next && !v.spectating ? v.next : '';
    const sig = `${text}|${mark}|${v.thinking}`;
    if (sig === statusSig) return;
    statusSig = sig;
    statusEl.textContent = '';
    if (mark && text) statusEl.appendChild(glyph(mark));
    const span = el('span', null, text);
    statusEl.appendChild(span);
    if (false) {
      const dots = el('span', 'dots');
      dots.append(el('i'), el('i'), el('i'));
      statusEl.appendChild(dots);
    }
    statusEl.style.color = mark === 'x' ? '#ffb1a6' : mark === 'o' ? '#ffe08a' : '#f7eedb';
  }

  // ---------------------------------------------------------------- go
  showScreen('title');
  if (online && room.match.phase !== 'lobby') showScreen('play');
  resize();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
  if (preview) runPreview(preview);
  function runPreview(full) {
    const name = full.replace(/-\d+x\d+$/, '');
    const A = 'a';
    const B = 'b';
    const play = (cells) => cells.forEach((c, i) => local.move(c, i % 2 === 0 ? local.view().data.x : local.view().data.o));
    const go = (mode, games, moves, extra = {}) => {
      Object.assign(prefs, { board: extra.board || 3, level: extra.level || 'normal', series: games, mark: 'x' });
      startLocal(mode);
      if (moves) play(moves);
    };
    void A;
    void B;
    if (name === 'ui-title') showScreen('title');
    else if (name === 'ui-setup') showScreen('setup');
    else if (name === 'ui-setup-friend') {
      previewFriend = { id: 'f1', name: 'Mira', ready: false };
      prefs.opponent = 'friend';
      showScreen('setup');
    } else if (name === 'ui-setup-5') {
      prefs.board = 5;
      showScreen('setup');
    } else if (name === 'ui-play') {
      go('computer', 5, [4, 0, 8, 2, 6]);
      anim.hint = { cell: 7, mark: 'o', until: 99 };
    } else if (name === 'ui-play-5') go('computer', 3, [12, 6, 18, 8, 7, 17, 13], { board: 5 });
    else if (name === 'ui-same') go('same', 3, [4, 0, 2]);
    else if (name === 'ui-win') go('computer', 5, [0, 3, 1, 4, 2]);
    else if (name === 'ui-draw') go('computer', 5, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    else if (name === 'ui-results') {
      go('computer', 1, [0, 3, 1, 4, 2]);
      local.tick(3.5);
    } else if (name === 'ui-play-4') go('same', 3, [5, 6, 10, 9, 15, 0], { board: 4 });
    setTimeout(() => {
      document.body.dataset.ready = '1';
    }, name === 'ui-results' ? 9000 : name === 'ui-win' || name === 'ui-draw' ? 2300 : 1800);
  }
  window.__ttt = { get screen() { return screen; }, get view() { return currentView(); }, room, online, startLocal, showScreen, prefs, setup: (id, v) => onPick(id, v) };
  void avatar;
  void hintsMatch;
  void hoverCell;
  void DEFAULTS;
}
