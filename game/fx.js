// Motion and particles: eased helpers, a camera shake from decaying trauma, a short hit-stop, confetti, dust and sparks.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (t, s = 1.70158) => {
  t = clamp01(t) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};
/** A spring that settles: 1 at the end, overshoots on the way. */
export const springOut = (t) => {
  t = clamp01(t);
  return 1 - Math.exp(-7 * t) * Math.cos(t * 11);
};

export class Fx {
  constructor() {
    this.parts = [];
    this.trauma = 0;
    this.time = 0;
    this.stop = 0; // seconds of hit-stop left
    this.reduced = false;
    this.cap = 400;
  }

  /** Adds shake (0..1). The offset is smooth noise scaled by trauma squared. */
  shake(amount) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  hitStop(ms) {
    if (!this.reduced) this.stop = Math.max(this.stop, ms / 1000);
  }

  /** The camera offset for this moment, in pixels at the given scale. */
  offset(scale = 1) {
    const k = this.trauma * this.trauma;
    if (k < 0.0004) return { x: 0, y: 0, a: 0 };
    const t = this.time;
    return { x: Math.sin(t * 47.3) * 9 * k * scale, y: Math.sin(t * 39.1 + 1.7) * 7 * k * scale, a: Math.sin(t * 31.7 + 0.4) * 0.012 * k };
  }

  /** Advances time; returns the dt the world should use (0 during a hit-stop). */
  tick(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    if (this.stop > 0) {
      this.stop -= dt;
      return 0;
    }
    this.update(dt);
    return dt;
  }

  add(p) {
    if (this.parts.length >= this.cap) this.parts.shift();
    this.parts.push(p);
  }

  dust(x, y, color = '#f7eedb', n = 7, size = 1) {
    const count = this.reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (30 + Math.random() * 70) * size;
      this.add({ kind: 'dust', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 10, life: 0.35 + Math.random() * 0.25, age: 0, r: (3 + Math.random() * 4) * size, color });
    }
  }

  sparks(x, y, color, n = 14, speed = 1) {
    const count = this.reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (90 + Math.random() * 220) * speed;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, age: 0, r: 2 + Math.random() * 3, color });
    }
  }

  /** Confetti from the top of the area: little coloured squares, rings and crosses. */
  confetti(w, h, colors, n = 110) {
    const count = this.reduced ? Math.ceil(n / 4) : n;
    const shapes = ['sq', 'ring', 'cross', 'sq'];
    for (let i = 0; i < count; i++) {
      this.add({
        kind: 'conf',
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.35,
        vx: (Math.random() - 0.5) * 120,
        vy: 80 + Math.random() * 180,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 9,
        sway: Math.random() * 6.28,
        life: 3.2 + Math.random() * 1.6,
        age: 0,
        r: 5 + Math.random() * 6,
        shape: shapes[i % shapes.length],
        color: colors[i % colors.length],
      });
    }
  }

  update(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps.splice(i, 1);
        continue;
      }
      if (p.kind === 'conf') {
        p.vy += 120 * dt;
        p.vy = Math.min(p.vy, 260);
        p.x += (p.vx + Math.sin(p.age * 3 + p.sway) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      } else {
        const drag = p.kind === 'dust' ? 3.2 : 2.2;
        p.vx -= p.vx * drag * dt;
        p.vy -= p.vy * drag * dt;
        if (p.kind === 'spark') p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  draw(ctx) {
    for (const p of this.parts) {
      const k = p.age / p.life;
      if (p.kind === 'dust') {
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + k), 0, 6.283);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - k * 0.6), 0, 6.283);
        ctx.fill();
      } else {
        ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Flutter: confetti narrows as it turns edge-on.
        ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.age * 5 + p.sway))));
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (p.shape === 'sq') ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        else if (p.shape === 'ring') {
          ctx.lineWidth = p.r * 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.r * 0.9, 0, 6.283);
          ctx.stroke();
        } else {
          ctx.lineWidth = p.r * 0.5;
          ctx.beginPath();
          ctx.moveTo(-p.r, -p.r);
          ctx.lineTo(p.r, p.r);
          ctx.moveTo(p.r, -p.r);
          ctx.lineTo(-p.r, p.r);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.parts.length = 0;
  }
}
