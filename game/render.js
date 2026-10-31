// Canvas drawing: the walnut table under a lamp, the lacquered board with brass inlay, chunky turned pieces that drop in
// with a squash, and a strip of tape laid across the winning line.
import { clamp01, easeOutCubic, easeInOutCubic, springOut } from './fx.js';
import { cellRect } from './layout.js';

export const PAL = {
  x: { base: '#ff5b4a', hi: '#ffa392', lo: '#a82418', deep: '#6f130c', name: 'Coral' },
  o: { base: '#ffc14a', hi: '#ffe7a3', lo: '#b27408', deep: '#6d4603', name: 'Gold' },
  cream: '#f7eedb',
  board: ['#2b4296', '#182659', '#0e1840'],
  boardSide: '#080e28',
  brass: ['#f0d58a', '#c79e45', '#8a6a24'],
  wood: ['#4a2d1b', '#2e1a10', '#170d08'],
};

const FALL = 0.11; // seconds a piece takes to drop onto the board

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.table = null;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
    this.table = null;
  }

  // ---------------------------------------------------------------- the table

  makeTable() {
    const { w, h, dpr } = this;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const rnd = seeded(41);
    g.fillStyle = PAL.wood[1];
    g.fillRect(0, 0, w, h);
    // planks
    const plank = Math.max(70, h / 6);
    for (let y = 0, i = 0; y < h + plank; y += plank, i++) {
      const shade = 0.5 + rnd() * 0.5;
      g.fillStyle = `rgba(${Math.round(74 * shade)},${Math.round(45 * shade)},${Math.round(27 * shade)},0.55)`;
      g.fillRect(0, y, w, plank);
      // grain
      for (let k = 0; k < 26; k++) {
        const gy = y + rnd() * plank;
        const amp = 1 + rnd() * 3;
        const ph = rnd() * 6.28;
        const fr = 0.004 + rnd() * 0.01;
        g.strokeStyle = rnd() < 0.5 ? 'rgba(10,5,2,0.20)' : 'rgba(200,140,80,0.07)';
        g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        for (let x = 0; x <= w; x += 24) {
          const yy = gy + Math.sin(x * fr + ph) * amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      // a knot now and then
      if (rnd() < 0.5) {
        const kx = rnd() * w;
        const ky = y + plank * (0.3 + rnd() * 0.4);
        for (let r = 3; r < 16; r += 3.2) {
          g.strokeStyle = 'rgba(15,8,3,0.14)';
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(kx, ky, r * 2.2, r, 0, 0, 6.28);
          g.stroke();
        }
      }
      // seam
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, y, w, 2);
      g.fillStyle = 'rgba(255,200,140,0.06)';
      g.fillRect(0, y + 2, w, 1);
    }
    // the lamp: a warm pool from the top-left, falling off to the corners
    const lx = w * 0.32;
    const ly = h * 0.28;
    const rad = Math.hypot(w, h) * 0.72;
    const pool = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
    pool.addColorStop(0, 'rgba(255,190,110,0.34)');
    pool.addColorStop(0.35, 'rgba(255,160,80,0.12)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, w, h);
    const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(6,2,0,0.72)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
    this.table = c;
  }

  // ---------------------------------------------------------------- a frame

  /**
   * scene: {
   *   t, board:{x,y,s}, n, cells[], last, placed:{[cell]:time}, removed:[{cell,mark,at}], lines[][], lineAt, winner, status,
   *   turn:'x'|'o'|'', hover:{cell,mark}|null, hint:{cell,mark,until}|null, cursor:-1, drawAt, pop (time of last board change),
   *   shake:{x,y,a}, fx:Fx, dim:0..1
   * }
   */
  frame(scene) {
    const { ctx, w, h, dpr } = this;
    if (!this.table) this.makeTable();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.table, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sh = scene.shake || { x: 0, y: 0, a: 0 };
    ctx.save();
    ctx.translate(w / 2 + sh.x, h / 2 + sh.y);
    ctx.rotate(sh.a);
    ctx.translate(-w / 2, -h / 2);
    this.drawBoard(scene);
    scene.fx?.draw(ctx);
    ctx.restore();
    if (scene.dim) {
      ctx.fillStyle = `rgba(10,5,2,${scene.dim})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawBoard(scene) {
    const { ctx } = this;
    const { board, n, t } = scene;
    let { x, y, s } = board;
    // the board pops when its size or the game changes, and a draw rattles it softly
    let ox = 0;
    let scale = 1;
    if (scene.pop != null) {
      const k = t - scene.pop;
      if (k >= 0 && k < 1) scale = 1 + (springOut(k / 0.6) - 1) * 0.06 - 0.05 * Math.exp(-k * 14);
    }
    if (scene.status === 'draw' && scene.drawAt != null) {
      const k = t - scene.drawAt;
      if (k >= 0 && k < 1.2) ox = Math.sin(k * 38) * 4 * Math.exp(-k * 4.2);
    }
    ctx.save();
    ctx.translate(x + s / 2 + ox, y + s / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(x + s / 2), -(y + s / 2));

    const thick = s * 0.04;
    const rad = s * 0.055;
    // soft shadow on the table
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = s * 0.08;
    ctx.shadowOffsetX = s * 0.02;
    ctx.shadowOffsetY = s * 0.05;
    rr(ctx, x, y + thick, s, s, rad);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    // the slab's edge: it glows faintly in the colour of whoever is to move
    const turn = scene.status === 'play' && scene.turn ? PAL[scene.turn] : null;
    rr(ctx, x, y + thick, s, s, rad);
    ctx.fillStyle = PAL.boardSide;
    ctx.fill();
    if (turn) {
      const pulse = 0.55 + 0.25 * Math.sin(t * 4);
      ctx.save();
      ctx.globalAlpha = pulse;
      const eg = ctx.createLinearGradient(0, y + s, 0, y + s + thick);
      eg.addColorStop(0, turn.base);
      eg.addColorStop(1, turn.lo);
      ctx.fillStyle = eg;
      rr(ctx, x + s * 0.06, y + s + thick * 0.15, s * 0.88, thick * 0.78, thick * 0.35);
      ctx.fill();
      ctx.restore();
    }
    // the lacquered face
    const face = ctx.createLinearGradient(x, y, x + s, y + s);
    face.addColorStop(0, PAL.board[0]);
    face.addColorStop(0.5, PAL.board[1]);
    face.addColorStop(1, PAL.board[2]);
    rr(ctx, x, y, s, s, rad);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.save();
    rr(ctx, x, y, s, s, rad);
    ctx.clip();
    // gloss: a pool of lamp light and a band that drifts across now and then
    const gl = ctx.createRadialGradient(x + s * 0.2, y + s * 0.1, 0, x + s * 0.2, y + s * 0.1, s * 0.9);
    gl.addColorStop(0, 'rgba(255,225,170,0.20)');
    gl.addColorStop(1, 'rgba(255,225,170,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, s, s);
    const phase = ((t * 0.11) % 1) * 2.6 - 0.8;
    const bx = x + s * phase;
    const band = ctx.createLinearGradient(bx - s * 0.18, y, bx + s * 0.18, y + s * 0.5);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.075)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(x, y, s, s);
    // an even edge light along the top-left
    ctx.strokeStyle = 'rgba(190,210,255,0.32)';
    ctx.lineWidth = Math.max(1.5, s * 0.004);
    rr(ctx, x + 1, y + 1, s - 2, s - 2, rad - 1);
    ctx.stroke();
    ctx.restore();

    const inset = s * 0.045;
    const gs = s - inset * 2;
    const cs = gs / n;
    // brass inlay between the cells
    const gw = Math.max(3, cs * 0.05);
    const a0 = inset * 0.6;
    const bg = ctx.createLinearGradient(x, y, x + s, y + s);
    bg.addColorStop(0, PAL.brass[0]);
    bg.addColorStop(0.5, PAL.brass[1]);
    bg.addColorStop(1, PAL.brass[2]);
    for (let i = 1; i < n; i++) {
      const p = inset + i * cs;
      for (const vertical of [true, false]) {
        const x1 = vertical ? x + p : x + a0;
        const y1 = vertical ? y + a0 : y + p;
        const x2 = vertical ? x + p : x + s - a0;
        const y2 = vertical ? y + s - a0 : y + p;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = gw * 1.7;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.strokeStyle = bg;
        ctx.lineWidth = gw;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,246,214,0.65)';
        ctx.lineWidth = Math.max(1, gw * 0.22);
        ctx.beginPath();
        ctx.moveTo(x1 - (vertical ? gw * 0.2 : 0), y1 - (vertical ? 0 : gw * 0.2));
        ctx.lineTo(x2 - (vertical ? gw * 0.2 : 0), y2 - (vertical ? 0 : gw * 0.2));
        ctx.stroke();
      }
    }
    // brass studs in the corners
    for (const [sx, sy] of [[0.5, 0.5], [s - 0.5, 0.5], [0.5, s - 0.5], [s - 0.5, s - 0.5]]) {
      const px = x + (sx < s / 2 ? inset * 0.42 + 0 : s - inset * 0.42);
      const py = y + (sy < s / 2 ? inset * 0.42 : s - inset * 0.42);
      const r = Math.max(2, inset * 0.18);
      const sg = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
      sg.addColorStop(0, '#fff2c4');
      sg.addColorStop(1, '#8a6a24');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 6.283);
      ctx.fill();
    }

    const losing = scene.status === 'won';
    const inWin = new Set((scene.lines || []).flat());
    // the cursor and the last move
    if (scene.cursor >= 0) {
      const r = cellRect(board, n, scene.cursor);
      ctx.strokeStyle = `rgba(247,238,219,${0.55 + 0.3 * Math.sin(t * 6)})`;
      ctx.lineWidth = 2.5;
      rr(ctx, r.x + cs * 0.06, r.y + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.12);
      ctx.stroke();
    }
    if (scene.last >= 0 && scene.cells[scene.last] && scene.status !== 'won') this.drawLastMark(scene, cs);

    // pieces
    for (let c = 0; c < scene.cells.length; c++) {
      const m = scene.cells[c];
      if (!m) continue;
      const r = cellRect(board, n, c);
      const placedAt = scene.placed ? scene.placed[c] : undefined;
      let k = placedAt == null ? 9 : t - placedAt;
      let alpha = 1;
      let lift = 0;
      let sx = 1;
      let sy = 1;
      let grow = 1;
      if (k < FALL) {
        const p = clamp01(k / FALL);
        lift = (1 - p * p) * cs * 0.55;
        grow = 1 + (1 - p) * 0.4;
        alpha = Math.min(1, p * 6 + 0.1);
      } else if (k < FALL + 0.6) {
        const q = (k - FALL) / 0.6;
        const sq = Math.exp(-q * 9) * Math.cos(q * 16);
        sy = 1 - 0.2 * sq;
        sx = 1 + 0.12 * sq;
      }
      if (losing && !inWin.has(c)) alpha *= 0.4;
      let glow = 0;
      if (inWin.has(c) && scene.lineAt != null) {
        const wk = t - scene.lineAt - 0.25;
        if (wk > 0) {
          grow *= 1 + 0.07 * Math.sin(wk * 6) * Math.min(1, wk * 2);
          glow = Math.min(1, wk * 2);
        }
      }
      this.drawPiece(m, r.cx, r.cy, cs, { lift, sx, sy, grow, alpha, glow, t });
    }
    // pieces being taken back
    for (const g of scene.removed || []) {
      const k = (t - g.at) / 0.22;
      if (k >= 1 || k < 0) continue;
      const r = cellRect(board, n, g.cell);
      this.drawPiece(g.mark, r.cx, r.cy - cs * 0.3 * k, cs, { lift: cs * 0.3 * k, sx: 1, sy: 1, grow: 1 - 0.3 * k, alpha: 1 - k, glow: 0, t });
    }
    // the ghost under the pointer, and a hint
    if (scene.hover && scene.hover.cell >= 0 && !scene.cells[scene.hover.cell]) {
      const r = cellRect(board, n, scene.hover.cell);
      this.drawPiece(scene.hover.mark, r.cx, r.cy, cs, { lift: cs * 0.04 + Math.sin(t * 5) * cs * 0.01, sx: 1, sy: 1, grow: 1, alpha: 0.34, glow: 0, t, flat: true });
    }
    if (scene.hint && scene.hint.cell >= 0 && t < scene.hint.until && !scene.cells[scene.hint.cell]) {
      const r = cellRect(board, n, scene.hint.cell);
      const left = scene.hint.until - t;
      const a = Math.min(1, left * 3) * (0.5 + 0.35 * Math.sin(t * 7));
      this.drawPiece(scene.hint.mark, r.cx, r.cy, cs, { lift: 0, sx: 1, sy: 1, grow: 1, alpha: a, glow: 0.8, t, flat: true });
      ctx.strokeStyle = `rgba(247,238,219,${a})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([cs * 0.1, cs * 0.08]);
      ctx.lineDashOffset = -t * 20;
      rr(ctx, r.x + cs * 0.08, r.y + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.14);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // the tape across the winning line
    if (scene.lines && scene.lines.length && scene.lineAt != null) {
      for (const line of scene.lines) this.drawTape(scene, line, cs);
    }
    ctx.restore();
  }

  drawLastMark(scene, cs) {
    const { ctx } = this;
    const r = cellRect(scene.board, scene.n, scene.last);
    const a = 0.5 + 0.25 * Math.sin(scene.t * 5);
    const m = cs * 0.1;
    const len = cs * 0.2;
    ctx.strokeStyle = `rgba(247,238,219,${a})`;
    ctx.lineWidth = Math.max(2, cs * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [cx, cy, dx, dy] of [[r.x + m, r.y + m, 1, 1], [r.x + cs - m, r.y + m, -1, 1], [r.x + m, r.y + cs - m, 1, -1], [r.x + cs - m, r.y + cs - m, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * len);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- pieces

  drawPiece(mark, cx, cy, cs, o) {
    const { ctx } = this;
    const pal = PAL[mark];
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    // the shadow on the board gets bigger and softer the higher the piece is
    const lift = o.lift || 0;
    ctx.translate(cx, cy);
    ctx.scale(o.sx * o.grow, o.sy * o.grow);
    const d = cs * 0.05; // visible thickness
    const T = cs * 0.19; // bar thickness
    const shadow = (blur, offY, a) => {
      ctx.shadowColor = `rgba(0,0,0,${a})`;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = cs * 0.02;
      ctx.shadowOffsetY = offY;
    };
    const noShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    };
    ctx.translate(0, -lift);
    ctx.lineCap = 'round';
    if (mark === 'x') {
      const a = cs * 0.2;
      const bars = [
        [-a, -a, a, a],
        [a, -a, -a, a],
      ];
      // first bar (underneath)
      const barLayers = (b, first) => {
        const [x1, y1, x2, y2] = b;
        if (!o.flat) {
          if (first) shadow(cs * 0.09 + lift * 0.4, cs * 0.045 + lift * 0.9, 0.55);
          ctx.strokeStyle = pal.deep;
          ctx.lineWidth = T;
          ctx.beginPath();
          ctx.moveTo(x1, y1 + d);
          ctx.lineTo(x2, y2 + d);
          ctx.stroke();
          noShadow();
        }
        ctx.strokeStyle = pal.lo;
        ctx.lineWidth = T;
        ctx.beginPath();
        ctx.moveTo(x1, y1 + d * 0.5);
        ctx.lineTo(x2, y2 + d * 0.5);
        ctx.stroke();
        const g = ctx.createLinearGradient(-a, -a, a, a * 1.4);
        g.addColorStop(0, pal.hi);
        g.addColorStop(0.45, pal.base);
        g.addColorStop(1, pal.lo);
        ctx.strokeStyle = o.glow ? pal.base : g;
        if (o.glow) {
          ctx.shadowColor = pal.base;
          ctx.shadowBlur = cs * 0.25 * o.glow;
        }
        ctx.lineWidth = T * 0.92;
        ctx.beginPath();
        ctx.moveTo(x1, y1 - d * 0.1);
        ctx.lineTo(x2, y2 - d * 0.1);
        ctx.stroke();
        noShadow();
        // bevel: a lighter ridge toward the lamp
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = T * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1 - T * 0.07, y1 - T * 0.12);
        ctx.lineTo(x2 - T * 0.07, y2 - T * 0.12);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = T * 0.13;
        ctx.beginPath();
        ctx.moveTo(x1 + (x2 - x1) * 0.12 - T * 0.22, y1 + (y2 - y1) * 0.12 - T * 0.26);
        ctx.lineTo(x1 + (x2 - x1) * 0.45 - T * 0.22, y1 + (y2 - y1) * 0.45 - T * 0.26);
        ctx.stroke();
      };
      barLayers(bars[0], true);
      // the top bar throws a little shadow on the one under it
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = T;
      ctx.beginPath();
      ctx.moveTo(bars[1][0] + d * 0.7, bars[1][1] + d * 1.6);
      ctx.lineTo(bars[1][2] + d * 0.7, bars[1][3] + d * 1.6);
      ctx.stroke();
      barLayers(bars[1], false);
    } else {
      const R = cs * 0.265;
      const circle = (rad, dy = 0) => {
        ctx.beginPath();
        ctx.arc(0, dy, rad, 0, 6.2832);
      };
      if (!o.flat) {
        shadow(cs * 0.09 + lift * 0.4, cs * 0.045 + lift * 0.9, 0.55);
        ctx.strokeStyle = pal.deep;
        ctx.lineWidth = T * 1.05;
        circle(R, d);
        ctx.stroke();
        noShadow();
      }
      ctx.strokeStyle = pal.lo;
      ctx.lineWidth = T * 1.05;
      circle(R, d * 0.5);
      ctx.stroke();
      const g = ctx.createLinearGradient(-R, -R, R, R * 1.3);
      g.addColorStop(0, pal.hi);
      g.addColorStop(0.45, pal.base);
      g.addColorStop(1, pal.lo);
      ctx.strokeStyle = o.glow ? pal.base : g;
      if (o.glow) {
        ctx.shadowColor = pal.base;
        ctx.shadowBlur = cs * 0.25 * o.glow;
      }
      ctx.lineWidth = T * 0.97;
      circle(R, -d * 0.1);
      ctx.stroke();
      noShadow();
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = T * 0.5;
      circle(R, -T * 0.05);
      ctx.stroke();
      // highlight along the upper-left of the ring, a shade along the lower right inside
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = T * 0.13;
      ctx.beginPath();
      ctx.arc(0, -d * 0.1, R - T * 0.1, Math.PI * 1.05, Math.PI * 1.45);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = Math.max(1.5, T * 0.1);
      ctx.beginPath();
      ctx.arc(0, d * 0.4, R - T * 0.44, Math.PI * 0.05, Math.PI * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- tape

  drawTape(scene, line, cs) {
    const { ctx } = this;
    const { board, n, t } = scene;
    const a = cellRect(board, n, line[0]);
    const b = cellRect(board, n, line[line.length - 1]);
    const ang = Math.atan2(b.cy - a.cy, b.cx - a.cx);
    const full = Math.hypot(b.cx - a.cx, b.cy - a.cy) + cs * 0.95;
    const k = easeOutCubic((t - scene.lineAt) / 0.5);
    if (k <= 0) return;
    const len = full * k;
    const wt = cs * 0.25;
    const pal = PAL[scene.winner] || PAL.x;
    ctx.save();
    ctx.translate(a.cx, a.cy);
    ctx.rotate(ang);
    ctx.translate(-cs * 0.475, 0);
    // the strip, with torn teeth at both ends
    const teeth = 3;
    const tooth = wt / teeth;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, -wt / 2);
      ctx.lineTo(len, -wt / 2);
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(len - (i % 2 === 0 ? cs * 0.04 : 0), -wt / 2 + tooth * (i + 0.5));
        ctx.lineTo(len, -wt / 2 + tooth * (i + 1));
      }
      ctx.lineTo(0, wt / 2);
      for (let i = teeth - 1; i >= 0; i--) {
        ctx.lineTo(cs * 0.04 * (i % 2 === 0 ? 1 : 0), -wt / 2 + tooth * (i + 0.5));
        ctx.lineTo(0, -wt / 2 + tooth * i);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = cs * 0.1;
    ctx.shadowOffsetY = cs * 0.045;
    path();
    ctx.fillStyle = PAL.cream;
    ctx.fill();
    ctx.restore();
    ctx.save();
    path();
    ctx.clip();
    // the winner's colour runs along both edges of the tape
    ctx.fillStyle = pal.base;
    ctx.fillRect(0, -wt / 2 + wt * 0.12, len, wt * 0.13);
    ctx.fillRect(0, wt / 2 - wt * 0.25, len, wt * 0.13);
    // a shine that runs along it once
    const sw = ((t - scene.lineAt - 0.3) / 0.7) * (full + cs);
    const sg = ctx.createLinearGradient(sw - cs * 0.4, 0, sw + cs * 0.4, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, -wt / 2, len, wt);
    ctx.restore();
    ctx.restore();
  }
}
