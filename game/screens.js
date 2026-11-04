// The setup (what the platform's strip starts) and the series result, built from plain models. Each returns { root, update(model) }.
import { el, glyph, avatar, Flap } from './ui.js';
import { LEVEL_NAMES } from './core.js';

function seg(label, id, options, value, onPick, cls = '') {
  const row = el('div', 'row' + (cls.includes('full') ? ' full' : ''));
  row.appendChild(el('div', 'lab', label));
  const box = el('div', `seg ${cls}`);
  for (const o of options) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(o.value === value));
    if (o.mark) b.appendChild(glyph(o.mark));
    b.appendChild(document.createTextNode(o.label));
    if (o.disabled) b.disabled = true;
    b.addEventListener('click', () => onPick(id, o.value));
    box.appendChild(b);
  }
  row.appendChild(box);
  return row;
}

const SERIES_LABEL = { 1: 'Single', 3: 'Best of 3', 5: 'Best of 5', 0: 'Endless' };

/**
 * model: {
 *   host (can change things), standalone, wide, prefs {opponent, level, mark, board, series, timer},
 *   alone, friend {name, avatarId} | null, me {name, avatarId}, hostPlayer {name, avatarId},
 *   ownStart: draw a Start because no platform lobby is there to
 * }
 * handlers: onPick(id, value), onStart(), onInvite()
 */
export function buildSetup(h, ow) {
  const root = el('section');
  root.id = 'setup';
  const scroll = el('div', 'scroll');
  let sig = '';
  const personSeat = (p) => {
    const s = el('div', 'seat plate');
    s.appendChild(avatar(p, { ow }));
    const t = el('div');
    t.style.minWidth = '0';
    t.appendChild(el('div', 'nm', p.name));
    s.appendChild(t);
    return s;
  };
  // a click leaves the focus with the game: Enter is the platform's Start or Ready while the lobby is up
  root.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) e.preventDefault();
  });
  return {
    root,
    /** The height the panel wants: its rows, and the Start button when there is no room around the game. */
    contentHeight() {
      const st = root.querySelector('.start-row');
      // The rows themselves: the scroll box stretches to the panel, so its own height would only ever grow.
      const rows = [...scroll.children].reduce((sum, c) => sum + c.offsetHeight, 0);
      return rows + 6 + (st ? st.offsetHeight + 8 : 0) + 24;
    },
    update(m) {
      const next = JSON.stringify(m);
      if (next === sig) return;
      sig = next;
      const keepScroll = scroll.scrollTop;
      root.textContent = '';
      scroll.textContent = '';
      root.classList.toggle('wide', !!m.wide);
      const p = m.prefs;
      const rows = el('div', 'rows');
      const opp = m.friend ? 'friend' : p.opponent;

      if (m.host) {
        if (!m.friend) {
          const options = [{ value: 'computer', label: 'Computer' }];
          if (m.alone) options.push({ value: 'same', label: 'Same screen' });
          const row = seg('Play', 'opponent', options, opp, h.onPick, 'full');
          if (!m.standalone) {
            const invite = el('button', null, 'Invite');
            invite.type = 'button';
            invite.addEventListener('click', h.onInvite);
            row.querySelector('.seg').appendChild(invite);
          }
          rows.appendChild(row);
        }
        if (opp === 'computer') rows.appendChild(seg('Level', 'level', ['easy', 'normal', 'unbeatable'].map((v) => ({ value: v, label: LEVEL_NAMES[v] })), p.level, h.onPick, 'full'));
        if (opp === 'computer' || opp === 'same') rows.appendChild(seg(opp === 'same' ? 'Player 1' : 'Your mark', 'mark', [{ value: 'x', label: 'X', mark: 'x' }, { value: 'o', label: 'O', mark: 'o' }], p.mark, h.onPick, 'two'));
        rows.appendChild(seg('Board', 'board', [3, 4, 5].map((v) => ({ value: v, label: `${v}x${v}` })), p.board, h.onPick, ''));
        rows.appendChild(seg('Series', 'series', [1, 3, 5, 0].map((v) => ({ value: v, label: SERIES_LABEL[v] })), p.series, h.onPick, 'wrap full'));
        if (opp === 'friend') rows.appendChild(seg('Turn timer', 'timer', [0, 15, 30].map((v) => ({ value: v, label: v ? `${v} s` : 'Off' })), p.timer, h.onPick, ''));
      } else {
        const line = [`${m.settings.board}x${m.settings.board}`, SERIES_LABEL[m.settings.series] ?? '', m.settings.timer ? `${m.settings.timer} s turns` : ''].filter(Boolean).join('  ·  ');
        const r = el('div', 'row full');
        r.appendChild(el('div', 'lab', 'Game'));
        const box = el('div', 'seat plate');
        box.appendChild(el('div', 'nm', line));
        r.appendChild(box);
        rows.appendChild(r);
      }

      if (m.friend || !m.host) {
        const r = el('div', 'row full');
        const seats = el('div', 'seats');
        seats.appendChild(personSeat(m.host ? m.me : m.hostPlayer));
        seats.appendChild(el('div', 'vs', 'vs'));
        seats.appendChild(personSeat(m.host ? m.friend : m.me));
        r.appendChild(seats);
        rows.appendChild(r);
      }
      scroll.appendChild(rows);
      root.appendChild(scroll);

      if (m.ownStart) {
        const start = el('div', 'start-row');
        const b = el('button', 'btn primary big', 'Start');
        b.type = 'button';
        b.addEventListener('click', h.onStart);
        start.appendChild(b);
        root.appendChild(start);
      }
      scroll.scrollTop = keepScroll;
    },
  };
}

/**
 * The series result. model: { champion: player|'draw', a, b, state:{a,b,d}, why, canSetup, record }
 */
export function buildResult(h, ow) {
  const root = el('div');
  root.id = 'result';
  const flaps = { a: new Flap(), b: new Flap(), d: new Flap(true) };
  let sig = '';
  return {
    root,
    update(m) {
      const next = JSON.stringify([m.champion && m.champion.id, m.championDraw, m.a && m.a.id, m.b && m.b.id, m.state, m.why, m.canSetup, m.record]);
      if (next === sig) return;
      sig = next;
      root.textContent = '';
      const panel = el('div', 'panel plate');
      panel.appendChild(el('div', 'over', m.over));
      if (m.championDraw) {
        panel.appendChild(el('h2', null, 'Draw'));
      } else {
        panel.appendChild(avatar(m.champion, { ow, big: true }));
        panel.appendChild(el('h2', null, m.champion.name));
      }
      const tiles = el('div', 'tiles');
      const col = (slot, label) => {
        const d = el('div');
        d.appendChild(flaps[slot].root);
        d.appendChild(el('div', 'cap', label));
        return d;
      };
      flaps.a.set(m.state.a, false);
      flaps.b.set(m.state.b, false);
      flaps.d.set(m.state.d, false);
      tiles.append(col('a', m.a.name), col('d', 'Draws'), col('b', m.b.name));
      panel.appendChild(tiles);
      if (m.why) panel.appendChild(el('div', 'why', m.why));
      if (m.record) panel.appendChild(el('div', 'record', m.record));
      const btns = el('div', 'btns');
      if (m.canSetup) {
        const s = el('button', 'btn', 'Setup');
        s.type = 'button';
        s.addEventListener('click', h.onSetup);
        btns.appendChild(s);
      }
      panel.appendChild(btns);
      root.appendChild(panel);
    },
  };
}
