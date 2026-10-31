// Store art: ?poster=<name> draws one staged frame with the real renderer, at the exact size, with a fixed seed. No platform, no UI.
import { Renderer, PAL } from './render.js';
import { Fx } from './fx.js';
import { cellRect } from './layout.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grid = (n, spec) => {
  const cells = new Array(n * n).fill('');
  for (const [m, list] of Object.entries(spec)) for (const c of list) cells[c] = m;
  return cells;
};

function scene(board, n, cells, extra = {}) {
  return { t: 10, board, n, cells, last: -1, placed: {}, removed: [], lines: null, lineAt: null, winner: '', status: 'play', turn: '', hover: null, hint: null, cursor: -1, drawAt: null, pop: null, shake: null, fx: null, dim: 0, ...extra };
}

function titleText(ctx, x, y, size, align = 'left') {
  ctx.save();
  ctx.font = `${size}px "Archivo Black", Impact, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  const lines = [['TIC', PAL.cream, '#6c5b3d', 0], ['TAC', PAL.x.base, PAL.x.lo, -0.035], ['TOE', PAL.o.base, PAL.o.lo, 0.025]];
  lines.forEach(([t, col, dark, rot], i) => {
    ctx.save();
    ctx.translate(x, y + i * size * 0.92);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(t, size * 0.05, size * 0.1);
    ctx.fillStyle = dark;
    ctx.fillText(t, 0, size * 0.06);
    ctx.fillStyle = col;
    ctx.fillText(t, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function circle(ctx, cx, cy, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 6.2832);
  ctx.fill();
}

function badge(r, ctx, id, w) {
  const c = w / 2;
  const colors = { 'first-win': PAL.x.base, stalemate: '#5a6fb8', 'hat-trick': PAL.o.base, 'big-board': '#3fa37a', 'friend-win': '#b8618f' }[id] || PAL.x.base;
  const g = ctx.createLinearGradient(0, 0, w, w);
  g.addColorStop(0, colors);
  g.addColorStop(1, '#1a1008');
  ctx.fillStyle = '#120a05';
  ctx.fillRect(0, 0, w, w);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  circle(ctx, c, c, c * 0.88, '#000');
  ctx.restore();
  circle(ctx, c, c, c * 0.88, PAL.brass[1]);
  circle(ctx, c, c, c * 0.8, g);
  const S = c * 0.5;
  const stroke = (col, wd) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = wd;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  ctx.save();
  ctx.translate(c, c);
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 4;
  const xMark = (x, y, s, col) => {
    stroke(col, s * 0.42);
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
  };
  const oMark = (x, y, s, col) => {
    stroke(col, s * 0.42);
    ctx.beginPath();
    ctx.arc(x, y, s * 1.05, 0, 6.2832);
    ctx.stroke();
  };
  if (id === 'first-win') {
    for (const dx of [-1, 0, 1]) xMark(dx * S * 0.72, 0, S * 0.26, PAL.cream);
    stroke(PAL.cream, S * 0.12);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-S * 1.1, 0);
    ctx.lineTo(S * 1.1, 0);
    ctx.stroke();
  } else if (id === 'stalemate') {
    xMark(-S * 0.45, 0, S * 0.42, PAL.x.hi);
    oMark(S * 0.5, 0, S * 0.4, PAL.o.hi);
    stroke(PAL.cream, S * 0.12);
    ctx.beginPath();
    ctx.moveTo(-S * 0.3, S * 0.85);
    ctx.lineTo(S * 0.3, S * 0.85);
    ctx.stroke();
  } else if (id === 'hat-trick') {
    // a big "3" and three small marks under it
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = PAL.cream;
    ctx.font = `${Math.round(S * 1.7)}px "Archivo Black", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('3', 0, -S * 0.15);
    for (const dx of [-1, 0, 1]) xMark(dx * S * 0.62, S * 0.9, S * 0.2, PAL.o.hi);
  } else if (id === 'big-board') {
    const n = 5;
    const cs = (S * 2) / n;
    stroke(PAL.cream, S * 0.09);
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(-S + i * cs, -S);
      ctx.lineTo(-S + i * cs, S);
      ctx.moveTo(-S, -S + i * cs);
      ctx.lineTo(S, -S + i * cs);
      ctx.stroke();
    }
    stroke(PAL.o.hi, S * 0.22);
    ctx.beginPath();
    ctx.moveTo(-S * 0.8, -S * 0.8);
    ctx.lineTo(S * 0.4, S * 0.4);
    ctx.stroke();
  } else {
    // two marks side by side under a crown
    xMark(-S * 0.5, S * 0.25, S * 0.3, PAL.cream);
    oMark(S * 0.5, S * 0.25, S * 0.3, PAL.cream);
    ctx.fillStyle = PAL.o.base;
    ctx.beginPath();
    ctx.moveTo(-S * 0.7, -S * 0.25);
    ctx.lineTo(-S * 0.7, -S * 0.9);
    ctx.lineTo(-S * 0.3, -S * 0.5);
    ctx.lineTo(0, -S);
    ctx.lineTo(S * 0.3, -S * 0.5);
    ctx.lineTo(S * 0.7, -S * 0.9);
    ctx.lineTo(S * 0.7, -S * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  void r;
}

export async function runPoster(name) {
  try {
    const params = new URLSearchParams(location.search);
    const body = document.body;
    body.style.cssText = 'margin:0;background:#1d120c;overflow:hidden';
    const cv = document.createElement('canvas');
    document.body.appendChild(cv);
    let [w, h] = SIZES[name] || [Number(params.get('w')) || 256, Number(params.get('h')) || 256];
    if (name.startsWith('badge-')) [w, h] = [256, 256];
    const r = new Renderer(cv);
    r.resize(w, h, 1);
    try {
      await document.fonts.load('40px "Archivo Black"');
      await document.fonts.ready;
    } catch {}
    const rnd = seeded(7);
    const realRandom = Math.random;
    Math.random = rnd;
    const ctx = r.ctx;

    if (name === 'cover') {
      const s = 640;
      const board = { x: 600, y: 40, s };
      const cells = grid(3, { x: [2, 4, 6, 8], o: [0, 1, 5] });
      const sc = scene(board, 3, cells, { lines: [[2, 4, 6]], lineAt: 9.2, winner: 'x', status: 'won', last: 6 });
      r.frame(sc);
      titleText(ctx, 70, 300, 190);
    } else if (name === 'action') {
      const n = 5;
      const board = { x: -170, y: -330, s: 1620 };
      const cells = grid(n, { x: [0, 6, 12, 18, 4, 8, 20, 14, 10], o: [1, 2, 5, 7, 11, 13, 15, 16, 19, 22] });
      r.frame(scene(board, n, cells, { lines: [[0, 6, 12, 18]], lineAt: 9.1, winner: 'x', status: 'won' }));
      const fx = new Fx();
      fx.sparks(520, 270, PAL.x.base, 30, 1.6);
      fx.update(0.12);
      ctx.save();
      fx.draw(ctx);
      ctx.restore();
    } else if (name === 'win') {
      const n = 4;
      const board = { x: 450, y: 118, s: 580 };
      const cells = grid(n, { x: [0, 5, 10, 15, 3, 8, 13], o: [1, 2, 4, 6, 9, 12] });
      const fx = new Fx();
      fx.confetti(w, h, [PAL.x.base, PAL.o.base, PAL.cream, '#7fb2ff'], 140);
      for (let i = 0; i < 24; i++) fx.update(0.05);
      r.frame(scene(board, n, cells, { lines: [[0, 5, 10, 15]], lineAt: 9.1, winner: 'x', status: 'won', fx }));
      // banner
      ctx.save();
      ctx.translate(w / 2, 62);
      ctx.rotate(-0.025);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(-330 + 6, -45 + 8, 660, 90);
      ctx.fillStyle = PAL.cream;
      ctx.fillRect(-330, -45, 660, 90);
      ctx.fillStyle = PAL.x.base;
      ctx.fillRect(-330, -36, 660, 7);
      ctx.fillRect(-330, 29, 660, 7);
      ctx.fillStyle = '#2a1308';
      ctx.font = '64px "Archivo Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YOU WIN', 0, 4);
      ctx.restore();
    } else if (name === 'icon') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, PAL.board[0]);
      g.addColorStop(1, PAL.board[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // wood corner glow
      const lamp = ctx.createRadialGradient(120, 90, 0, 120, 90, 420);
      lamp.addColorStop(0, 'rgba(255,200,120,.28)');
      lamp.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = lamp;
      ctx.fillRect(0, 0, w, h);
      // brass seam
      ctx.fillStyle = PAL.brass[1];
      ctx.fillRect(w / 2 - 4, 70, 8, h - 140);
      r.drawPiece('x', 160, 256, 250, { lift: 0, sx: 1, sy: 1, grow: 1, alpha: 1, glow: 0, t: 0 });
      r.drawPiece('o', 352, 256, 250, { lift: 0, sx: 1, sy: 1, grow: 1, alpha: 1, glow: 0, t: 0 });
    } else if (name.startsWith('badge-')) {
      badge(r, ctx, name.slice(6), w);
    } else throw new Error(`unknown poster ${name}`);
    Math.random = realRandom;
    void cellRect;
    document.body.dataset.ready = '1';
  } catch (e) {
    console.error(e);
    document.body.dataset.ready = 'error';
    document.body.dataset.error = String(e && e.message);
  }
}
