// The DOM over the canvas: title, setup, scoreboard of split-flap tiles, status line, actions, banner, results.
// Everything player-written (names) goes in with textContent.
import { LEVEL_NAMES } from './core.js';

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** A mark as a little shape: X is two crossed bars, O a ring. */
export function glyph(mark) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `g ${mark}`);
  s.setAttribute('aria-hidden', 'true');
  if (mark === 'x') {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M5.5 5.5L18.5 18.5M18.5 5.5L5.5 18.5');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '5');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('fill', 'none');
    s.appendChild(p);
  } else {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '7');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', 'currentColor');
    c.setAttribute('stroke-width', '5');
    s.appendChild(c);
  }
  return s;
}

function chipSvg() {
  // The computer: a small chip with pins and one lit eye.
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('class', 'chip');
  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    s.appendChild(n);
    return n;
  };
  add('rect', { width: 48, height: 48, fill: '#243a78' });
  for (let i = 0; i < 4; i++) {
    add('rect', { x: 12 + i * 8, y: 6, width: 3, height: 7, fill: '#d6b25e' });
    add('rect', { x: 12 + i * 8, y: 35, width: 3, height: 7, fill: '#d6b25e' });
  }
  add('rect', { x: 11, y: 13, width: 26, height: 22, rx: 4, fill: '#0e1840', stroke: '#d6b25e', 'stroke-width': 2 });
  add('rect', { x: 16, y: 19, width: 6, height: 6, fill: '#f7eedb' });
  add('rect', { x: 26, y: 19, width: 6, height: 6, fill: '#ffc14a' });
  add('rect', { x: 17, y: 28, width: 14, height: 3, rx: 1.5, fill: '#f7eedb' });
  return s;
}

const avatarUrls = new Map();

/** A player's face: their avatar when there is one, else the first letter on a disc (a chip for the computer). */
export function avatar(p, { ow = null, mark = '', big = false } = {}) {
  const a = el('div', 'av' + (big ? ' big' : ''));
  if (!p) return a;
  if (p.bot) a.appendChild(chipSvg());
  else {
    const ini = el('span', 'ini', (p.name || '?').trim().slice(0, 1).toUpperCase() || '?');
    a.appendChild(ini);
    if (ow && p.avatarId && ow.player && ow.player.avatarUrl) {
      const set = (url) => {
        if (!url) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.alt = '';
        img.onload = () => {
          ini.remove();
          a.appendChild(img);
        };
        img.src = url;
      };
      if (avatarUrls.has(p.avatarId)) set(avatarUrls.get(p.avatarId));
      else {
        try {
          Promise.resolve(ow.player.avatarUrl(p.avatarId, 'head')).then((url) => {
            avatarUrls.set(p.avatarId, url);
            set(url);
          }, () => {});
        } catch {}
      }
    }
  }
  if (mark) {
    const m = el('span', 'mk');
    m.appendChild(glyph(mark));
    a.appendChild(m);
  }
  return a;
}

/** A split-flap tile: a number that turns over when it changes. */
export class Flap {
  constructor(small = false) {
    this.root = el('div', 'flap' + (small ? ' sm' : ''));
    this.value = null;
    this.top = el('div', 'h t');
    this.bot = el('div', 'h b');
    this.top.appendChild(el('span'));
    this.bot.appendChild(el('span'));
    this.root.append(this.top, this.bot);
    this.fl = [];
  }

  /** onFlip(): called when the tile starts to turn (for the sound). */
  set(v, animate = true, onFlip = null) {
    const text = String(v);
    if (this.value === text) return;
    const old = this.value;
    this.value = text;
    this.root.classList.toggle('l3', text.length >= 3);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const f of this.fl) f.remove();
    this.fl = [];
    if (old == null || !animate || reduce) {
      this.top.firstChild.textContent = text;
      this.bot.firstChild.textContent = text;
      return;
    }
    // static halves: new top, old bottom; flippers: old top turns away, new bottom turns in
    this.top.firstChild.textContent = text;
    this.bot.firstChild.textContent = old;
    const ft = el('div', 'h t fl');
    ft.appendChild(el('span', null, old));
    const fb = el('div', 'h b fl');
    fb.appendChild(el('span', null, text));
    this.root.append(ft, fb);
    this.fl = [ft, fb];
    if (onFlip) onFlip();
    fb.addEventListener('animationend', () => {
      this.bot.firstChild.textContent = text;
      ft.remove();
      fb.remove();
      this.fl = [];
    });
  }
}

function ringSvg() {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'ring');
  s.setAttribute('viewBox', '0 0 60 60');
  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('class', 'bg');
  bg.setAttribute('cx', '30');
  bg.setAttribute('cy', '30');
  bg.setAttribute('r', '27');
  const fg = document.createElementNS(NS, 'circle');
  fg.setAttribute('class', 'fg');
  fg.setAttribute('cx', '30');
  fg.setAttribute('cy', '30');
  fg.setAttribute('r', '27');
  fg.setAttribute('stroke-dasharray', '169.6');
  fg.setAttribute('stroke-dashoffset', '0');
  s.append(bg, fg);
  return s;
}

// ---------------------------------------------------------------------- the scoreboard

export class Scoreboard {
  constructor(root, ow, sound) {
    this.root = root;
    this.ow = ow;
    this.sound = sound;
    this.sig = '';
    this.cards = {};
    this.draws = new Flap(true);
    this.flaps = { a: new Flap(), b: new Flap() };
    this.built = false;
  }

  /** v: the view. Rebuilt only when the players change; numbers and marks update in place. */
  update(v, mode) {
    if (!v.a || !v.b) return;
    this.root.classList.toggle('row', mode === 'row');
    this.root.classList.toggle('col', mode === 'col');
    const sig = [v.a.id, v.b.id, v.a.name, v.b.name, v.a.avatarId, v.b.avatarId, v.a.me, v.b.me].join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.root.textContent = '';
      this.cards = {};
      for (const slot of ['a', 'b']) {
        const p = v[slot];
        const card = el('div', `card plate ${slot}`);
        const av = avatar(p, { ow: this.ow });
        if (p.me && v.mode !== 'same') av.classList.add('me');
        card.append(av, this.flaps[slot].root);
        const nm = el('div', 'nm', p.name);
        card.appendChild(nm);
        this.cards[slot] = { card, av, nm, ring: null, mk: null, mark: '' };
      }
      const mid = el('div', 'mid plate');
      mid.append(this.draws.root, el('div', 'cap', 'Draws'));
      this.mid = mid;
      this.root.append(this.cards.a.card, mid, this.cards.b.card);
    }
    const flip = () => this.sound && this.sound(2);
    this.flaps.a.set(v.state.a, true, flip);
    this.flaps.b.set(v.state.b, true, flip);
    this.draws.set(v.state.d, true, flip);
    for (const slot of ['a', 'b']) {
      const c = this.cards[slot];
      const p = v[slot];
      const mark = v.byMark.x === p ? 'x' : v.byMark.o === p ? 'o' : '';
      if (mark !== c.mark) {
        c.mark = mark;
        if (c.mk) c.mk.remove();
        c.mk = null;
        if (mark) {
          c.mk = el('span', 'mk');
          c.mk.appendChild(glyph(mark));
          c.av.appendChild(c.mk);
        }
      }
      const turn = !!v.turnP && v.turnP === p && v.phase === 'play';
      c.card.classList.toggle('turn', turn);
      c.card.classList.toggle('x', turn && mark === 'x');
      c.card.classList.toggle('o', turn && mark === 'o');
      c.card.classList.toggle('dim', v.phase === 'play' && !turn);
      c.card.classList.toggle('away', !!p.away);
      // the turn timer is a ring around the mover's face
      const ringOn = turn && v.timer > 0 && v.timeLeft != null;
      if (ringOn && !c.ring) {
        c.ring = ringSvg();
        c.av.appendChild(c.ring);
      } else if (!ringOn && c.ring) {
        c.ring.remove();
        c.ring = null;
      }
      if (c.ring) {
        const frac = Math.max(0, Math.min(1, v.timeLeft / v.timer));
        const fg = c.ring.querySelector('.fg');
        fg.setAttribute('stroke-dashoffset', String(169.6 * (1 - frac)));
        fg.style.stroke = v.timeLeft < 5 ? '#ff5b4a' : '';
      }
    }
  }
}

export function place(node, r) {
  node.style.left = `${Math.round(r.x)}px`;
  node.style.top = `${Math.round(r.y)}px`;
  node.style.width = `${Math.round(r.w)}px`;
  node.style.height = `${Math.round(r.h)}px`;
}

export { LEVEL_NAMES };
